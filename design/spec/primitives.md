# Shared primitives

New components introduced by this redesign. Build these once; per-screen docs reference them by name.

## `<Button />`

`web/src/components/ui/Button.tsx` — replaces ad-hoc button styling across the app.

Props:
```ts
type ButtonProps = {
  variant?: 'default' | 'accent' | 'ghost' | 'danger';  // default = 'default'
  size?: 'sm' | 'md' | 'lg';                            // default = 'md'
  wide?: boolean;                                       // width: 100%
  icon?: JSX.Element;                                   // leading icon
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  children: JSX.Element | string;
  type?: 'button' | 'submit';
  'aria-label'?: string;                                // required if icon-only
};
```

Used everywhere. See `class-vocabulary.md → Buttons` for class composition.

## `<Card />` + `<Card.Header />`, `<Card.Body />`, `<Card.Footer />`

`web/src/components/ui/Card.tsx`. Compound component. Used on Dashboard, Settings, Quote detail, Job detail.

## `<StatusPill state />`

`web/src/components/ui/StatusPill.tsx`. Single source of truth for state → pill mapping.

```ts
type QuoteState = 'DRAFT' | 'SENT' | 'AWAITING' | 'RESPONDED' | 'WON' | 'LOST';
type JobState = 'SCHEDULED' | 'INPROGRESS' | 'CLOSED';
type StatusPillProps = { state: QuoteState | JobState; size?: 'sm' | 'md' };
```

State → label → pill modifier table:

| State | Label | Pill class |
|---|---|---|
| `DRAFT` | "Draft" | `.pill--draft` |
| `SENT` | "Sent" | `.pill--sent` |
| `AWAITING` | "Awaiting" | `.pill--awaiting` |
| `RESPONDED` | "Responded" | `.pill--responded` |
| `WON` | "Won" | `.pill--won` |
| `LOST` | "Lost" | `.pill--lost` |
| `SCHEDULED` | "Scheduled" | `.pill--scheduled` |
| `INPROGRESS` | "In progress" | `.pill--inprogress` |
| `CLOSED` | "Closed" | `.pill--closed` |

Renders `<span aria-label="Status: Awaiting">` so the state is announced regardless of icon presence.

## `<DataTable />`

`web/src/components/ui/DataTable.tsx`. Used on `/bids` (Table view), `/jcr` (jobs list), `/clients`.

Props:
```ts
type DataTableProps<T> = {
  columns: Array<{
    key: keyof T | string;
    header: string;
    align?: 'left' | 'right';
    render?: (row: T) => JSX.Element;
    width?: string;          // CSS width (px or %)
    mono?: boolean;          // numeric columns
  }>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: JSX.Element;   // falls through to <EmptyState> if omitted
  loading?: boolean;          // shows skeleton rows
};
```

Loading state: 6 skeleton rows with shimmer (`animate-pulse bg-[color:var(--color-bg-2)]`).
Empty state: receives `emptyState` slot; default falls back to `<EmptyState variant="table" />`.

## `<EmptyState />`

`web/src/components/ui/EmptyState.tsx`. Empty/error/cold-start states are primary screens, not error screens (see `empty-states.md`).

```ts
type EmptyStateProps = {
  eyebrow?: string;       // e.g. "Cold start"
  title: string;          // serif headline
  body: string;           // editorial copy, 1–3 sentences
  primary?: { label: string; onClick: () => void; icon?: JSX.Element };
  secondary?: { label: string; onClick: () => void };
  illustration?: 'paper' | 'stack' | 'agenda' | 'none';  // default 'paper'
};
```

Layout: centered column, max-width 480px. Eyebrow → serif title (24px) → muted body (14px) → primary + secondary buttons in row. Illustration is a single line-drawn icon in `var(--color-muted-2)`, 48×48.

## `<SlideOver />`

`web/src/components/ui/SlideOver.tsx`. Right-side drawer. Used by Reply/Nudge (Quotes), and reused later for Send-quote and Postmortem-from-job.

```ts
type SlideOverProps = {
  open: boolean;
  onClose: () => void;
  eyebrow: string;        // e.g. "Brief drafted a reply"
  title: string;          // contextual — client name + ref
  width?: number;         // default 560
  children: JSX.Element;
  footer?: JSX.Element;   // sticky bottom action bar
};
```

Behavior:
- Slides in from right, 180ms ease-out, opacity 0→1 on backdrop.
- Backdrop click closes; Esc closes; focus traps inside drawer.
- On open: focus moves to the first focusable element (subject input on Reply/Nudge).
- On close: focus returns to the trigger element (the originating row's action button).
- Scrolls internally if content exceeds viewport; footer stays sticky.

## `<Stepper />`

`web/src/components/ui/Stepper.tsx`. Used on Onboarding (7 steps) and Quote production (6 steps).

```ts
type StepperProps = {
  steps: Array<{ id: string; label: string }>;
  current: string;                  // id of active step
  completed: string[];              // ids of done steps
  onStepClick?: (id: string) => void;  // optional — only enabled for completed steps
  orientation?: 'horizontal' | 'vertical';  // default 'horizontal'
};
```

Visual: numbered dots connected by a thin line. Active step has the accent ring; completed steps show a checkmark in the accent dot; future steps are muted.

## `<AgendaGroup />` + `<AgendaRow />`

`web/src/components/quotes/AgendaGroup.tsx`, `AgendaRow.tsx`. Specific to `/bids` (Quotes — Agenda view). Not used elsewhere yet — keep them in the `quotes/` namespace, not `ui/`.

Group props:
```ts
type AgendaGroupProps = {
  title: string;                    // "Today", "This week", etc.
  subtitle: string;                 // editorial one-liner
  tone: 'high' | 'med' | 'warn' | 'low' | 'done';
  quotes: Quote[];                  // see data-shapes.md
  defaultCollapsed?: boolean;
};
```

Row props:
```ts
type AgendaRowProps = {
  quote: Quote;
  onAction: (mode: 'reply' | 'nudge' | 'open') => void;
};
```

Row layout: status pill → client + project + "NEXT" reasoning line → dollar value + age → action button + send-time chip.
See `quotes-agenda.md` for full spec and screenshots.

## `<MetricCard />`

`web/src/components/dashboard/MetricCard.tsx`. KPI tile for Dashboard.

```ts
type MetricCardProps = {
  label: string;
  value: string;             // already formatted by caller
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  spark?: number[];          // tiny sparkline data; if present, renders below value
  href?: string;             // if present, whole card is a link
};
```

## `<CostReconciliation />`

`web/src/components/jobs/CostReconciliation.tsx`. Specific to Jobs (`/jcr`). New primitive — call out for review since it's the most complex new component.

```ts
type CostLine = {
  category: 'labor' | 'materials' | 'subs' | 'permits' | 'equipment' | 'other';
  description: string;
  estimated: number;         // from the original quote
  actual: number | null;     // null = not yet reconciled
  source?: 'payroll' | 'receipts' | 'manual';
};
type CostReconciliationProps = {
  jobId: string;
  lines: CostLine[];
  totals: { estimated: number; actual: number; variance: number; variancePct: number };
  onMarkActual: (lineId: string, value: number) => void;
};
```

Three-column table: Description / Estimated / Actual + Variance. Variance > +10% renders in `text-warn`; > +20% in `text-danger`. Negative variance (came in under) renders in `text-good`.

## `<ProgressiveRender />`

`web/src/components/ui/ProgressiveRender.tsx`. Wrapper around the SSE consumer for AI-streaming surfaces (Quote production AI scan, Reply/Nudge draft).

```ts
type ProgressiveRenderProps<T> = {
  endpoint: string;          // POST URL
  body: Record<string, unknown>;
  onEvent: (event: { type: string; payload: T }) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  children: JSX.Element;     // the surface to render — controlled by parent state
};
```

Implementation mirrors `BidGenerator.tsx:82–101` — buffer reader chunks, split on `\n\n`, JSON-parse each `data:` line, branch on `payload.type`, dispatch to `onEvent`. The component itself renders no chrome; it's a behavior wrapper.
