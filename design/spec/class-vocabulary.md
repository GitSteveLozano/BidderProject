# Class vocabulary — prototype → Tailwind

The prototype uses raw CSS with custom-property tokens. This doc translates each prototype class to its Tailwind equivalent so you can implement screens against `screenshots/*.png` without parsing `styles.css` by hand.

Every prototype class falls into one of: **layout shells, buttons, cards, typography helpers, status pills, forms, tables, KPIs, utilities, slide-over.** Class-name conventions follow BEM-lite (`block__element--modifier`).

## App shell

| Prototype | Tailwind | Notes |
|---|---|---|
| `.app` | `grid grid-cols-[252px_1fr] h-screen` | Sidebar + main column |
| `.main` | `flex flex-col min-w-0 overflow-hidden` | |
| `.page` | `flex-1 overflow-auto` | The scrollable region |
| `.page__inner` | `max-w-[1240px] mx-auto px-10 py-8` | Content max-width |

## Sidebar

| Prototype | Tailwind |
|---|---|
| `.sidebar` | `bg-[color:var(--color-bg-2)] border-r border-[color:var(--color-line)] p-4 flex flex-col gap-3 min-h-0` |
| `.sidebar__brand` | `flex items-center gap-2.5 px-1 pb-3` |
| `.brand-mark` | `w-7 h-7 rounded-lg bg-[color:var(--color-ink)] text-[color:var(--color-bg)] flex items-center justify-center font-serif font-semibold text-[16px] leading-none` |
| `.brand-word` | `font-serif text-[20px] font-medium leading-none` |
| `.sidebar__shop` | `flex items-center gap-2.5 p-2.5 rounded-lg bg-[color:var(--color-surface)] border border-[color:var(--color-line)] cursor-pointer` |
| `.nav` | `flex flex-col gap-px` |
| `.nav__group-label` | `text-eyebrow text-[color:var(--color-muted-2)] px-2.5 pt-3 pb-1 font-medium` |
| `.nav__item` | `flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-sm text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-surface)] cursor-pointer` |
| `.nav__item.is-active` | add `bg-[color:var(--color-surface)] text-[color:var(--color-ink)] font-medium shadow-sm` |
| `.nav__badge` | `ml-auto font-mono text-[11px] text-[color:var(--color-muted)]` |

## Topbar

| Prototype | Tailwind |
|---|---|
| `.topbar` | `flex items-center gap-3.5 px-10 py-3.5 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg)]` |
| `.crumbs` | `flex items-center gap-2 text-[13px] text-[color:var(--color-muted)]` |
| `.crumbs .now` | `text-[color:var(--color-ink)] font-medium` |
| `.search` | `flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[color:var(--color-surface)] border border-[color:var(--color-line)] w-[320px]` |
| `.search input` | `bg-transparent border-0 outline-none flex-1 text-[13px]` |
| `.kbd` | `font-mono text-[11px] text-[color:var(--color-muted-2)] border border-[color:var(--color-line)] rounded px-1` |

## Buttons

Base: `.btn`

```
inline-flex items-center justify-center gap-[7px] px-3 py-2 text-[13px] font-medium
rounded-lg bg-[color:var(--color-surface)] border border-[color:var(--color-line)]
text-[color:var(--color-ink)] whitespace-nowrap cursor-pointer
hover:bg-[color:var(--color-surface-2)] hover:border-[color:var(--color-line-strong)]
focus:outline-2 focus:outline-offset-2 focus:outline-accent-500
disabled:opacity-45 disabled:cursor-not-allowed
```

Modifiers:

| Prototype | Add to base |
|---|---|
| `.btn--accent` | `bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] border-[color:var(--color-accent)] hover:brightness-95 hover:bg-[color:var(--color-accent)]` |
| `.btn--ghost` | replace bg/border with `bg-transparent border-transparent hover:bg-[color:var(--color-surface)]` |
| `.btn--wide` | `w-full py-2.5 px-3.5` |
| `.btn--lg` | `py-3 px-5 text-sm` |
| `.btn--sm` | `py-[5px] px-2.5 text-[12px]` |
| `.btn--danger` | `text-[color:var(--color-danger)] hover:bg-[color:var(--color-surface)]` |

## Cards

| Prototype | Tailwind |
|---|---|
| `.card` | `bg-[color:var(--color-surface)] border border-[color:var(--color-line)] rounded-lg shadow-sm` |
| `.card--flat` | replace `shadow-sm` with `shadow-none` |
| `.card__hd` | `flex items-center gap-2.5 px-5 py-3.5 border-b border-[color:var(--color-line)]` |
| `.card__hd h3` | `m-0 font-serif text-base font-medium flex-1` |
| `.card__body` | `p-5` |
| `.card__ft` | `px-5 py-3.5 border-t border-[color:var(--color-line)] flex items-center gap-2` |

## Typography helpers

| Prototype | Tailwind |
|---|---|
| `.h-display` | `font-serif font-normal text-5xl tracking-tight leading-[1.05]` |
| `.h-page` | `font-serif font-medium text-[28px] tracking-tight leading-tight` |
| `.h-section` | `font-serif font-medium text-lg leading-tight m-0` |
| `.eyebrow` | `font-mono text-eyebrow text-[color:var(--color-muted-2)] uppercase font-medium` |
| `.muted` | `text-[color:var(--color-muted)]` |
| `.muted-2` | `text-[color:var(--color-muted-2)]` |
| `.mono` | `font-mono` |
| `.serif` | `font-serif` |
| `.num` | `font-mono tabular-nums` |

## Status pills

Base: `.pill`

```
inline-flex items-center gap-1.5 px-2 py-[2px] rounded
text-[10.5px] font-mono font-medium uppercase tracking-[0.06em]
border border-transparent whitespace-nowrap
before:content-[''] before:w-[5px] before:h-[5px] before:rounded-full before:bg-current
```

Modifiers (background = tint, foreground = solid):

| Prototype | Add to base | Used for |
|---|---|---|
| `.pill--draft` | `bg-[color:var(--color-bg-2)] text-[color:var(--color-muted)] border-[color:var(--color-line-2)]` | Draft quotes |
| `.pill--sent` | `bg-info-tint text-info` (uses `var(--color-info-tint)` etc.) | Sent, no response |
| `.pill--awaiting` | `bg-warn-tint text-warn` | Awaiting decision |
| `.pill--responded` | `bg-accent-100 text-accent-500` | Client replied |
| `.pill--won` | `bg-good-tint text-good` | Won |
| `.pill--lost` | same as `--draft` | Lost / muted |
| `.pill--inprogress` | `bg-info-tint text-info` | Job in progress |
| `.pill--scheduled` | `bg-warn-tint text-warn` | Job scheduled |
| `.pill--closed` | `bg-good-tint text-good` | Job closed |

## Forms

| Prototype | Tailwind |
|---|---|
| `.field` | `flex flex-col gap-1.5` |
| `.field__lbl` | `text-[11.5px] font-medium text-[color:var(--color-ink-2)] uppercase tracking-[0.06em] font-mono` |
| `.input`, `.textarea`, `.select` | `w-full px-3 py-2.5 rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface)] text-sm text-[color:var(--color-ink)] font-sans` + `focus:border-accent-500 focus:shadow-[0_0_0_3px_var(--color-accent-tint)] focus:outline-none` |
| `.textarea` | adds `resize-y min-h-[96px] leading-[1.45]` |

## Tables

| Prototype | Tailwind |
|---|---|
| `.tbl` | `w-full border-collapse` |
| `.tbl th` | `text-left text-[10.5px] font-mono font-medium uppercase tracking-[0.06em] text-[color:var(--color-muted)] px-3.5 py-3 border-b border-[color:var(--color-line)]` |
| `.tbl td` | `px-3.5 py-3 border-b border-[color:var(--color-line)] text-sm align-middle` |
| `.tbl tr:last-child td` | `border-b-0` |
| `.tbl tbody tr` | `cursor-pointer transition-colors duration-100 hover:bg-[color:var(--color-surface-2)]` |

## KPI

| Prototype | Tailwind |
|---|---|
| `.kpi` | `flex flex-col gap-1` |
| `.kpi__lbl` | `font-mono text-[11px] text-[color:var(--color-muted)] uppercase tracking-[0.08em]` |
| `.kpi__val` | `font-serif text-kpi font-medium leading-none tabular-nums` |
| `.kpi__delta` | `font-mono text-[11px] inline-flex items-center gap-1` |
| `.kpi__delta--up` | `text-good` |
| `.kpi__delta--dn` | `text-danger` |

## Misc utilities

| Prototype | Tailwind |
|---|---|
| `.row` | `flex items-center gap-3` |
| `.col` | `flex flex-col gap-3` |
| `.grow`, `.space` | `flex-1` |
| `.italic` | `italic` |

## Component-extraction approach

For the recurring patterns (button, card, pill, table cell), wrap as Solid/Astro components rather than retyping the class string. Suggested structure:

```
web/src/components/ui/
  Button.tsx          // .btn + modifiers via prop
  Card.tsx            // .card + Header / Body / Footer slots
  Pill.tsx            // .pill — state prop drives modifier
  Field.tsx           // .field + label + input
  KpiBlock.tsx        // .kpi composite
  DataTable.tsx       // .tbl — used on /bids, /jcr, /clients
  SlideOver.tsx       // Reply/Nudge drawer (see primitives.md)
  EmptyState.tsx      // see primitives.md
  StatusPill.tsx      // wrapper around Pill with state→modifier mapping
```

`primitives.md` enumerates the prop shapes for each.
