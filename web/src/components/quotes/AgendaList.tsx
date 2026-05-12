/**
 * <AgendaList> — full Agenda view for /quotes.
 *
 * Renders grouped quote rows (Today / This week / Cooling off / Later /
 * Decided) with pipeline-value strip across the top, Reply/Nudge
 * drawers, and view toggle to Table.
 */
import { createSignal, For, Show, createMemo } from 'solid-js';
import {
  bucketQuotes,
  fmtAge,
  fmtCurrencyCompact,
  fmtCurrencyFull,
  type AgendaQuote,
  type QuoteState,
} from '@/lib/quote-helpers';
import Button from '@/components/ui/Button';
import StatusPill from '@/components/ui/StatusPill';
import SlideOver from '@/components/ui/SlideOver';
import Field, { Input } from '@/components/ui/Field';
import ReplyNudgeDrawer from './ReplyNudgeDrawer';

interface Props {
  quotes: AgendaQuote[];
}

type View = 'agenda' | 'table';

export default function AgendaList(props: Props) {
  const [view, setView] = createSignal<View>('agenda');
  const [drawerMode, setDrawerMode] = createSignal<'reply' | 'nudge' | null>(null);
  const [drawerQuote, setDrawerQuote] = createSignal<AgendaQuote | null>(null);

  const buckets = createMemo(() => bucketQuotes(props.quotes));
  const pipeline = createMemo(() => pipelineByState(props.quotes));

  const openDrawer = (mode: 'reply' | 'nudge', q: AgendaQuote) => {
    setDrawerMode(mode);
    setDrawerQuote(q);
  };
  const closeDrawer = () => {
    setDrawerMode(null);
    setDrawerQuote(null);
  };

  return (
    <div>
      <div class="flex items-end justify-between mb-6">
        <div>
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-1">
            Quotes
          </div>
          <h1 class="font-serif text-[28px] font-medium leading-tight">
            What's open.
          </h1>
        </div>
        <div class="inline-flex rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-0.5 text-xs">
          <button
            class={[
              'px-3 py-1.5 rounded-md font-medium',
              view() === 'agenda'
                ? 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink)]'
                : 'text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]',
            ].join(' ')}
            onClick={() => setView('agenda')}
          >
            Agenda
          </button>
          <button
            class={[
              'px-3 py-1.5 rounded-md font-medium',
              view() === 'table'
                ? 'bg-[color:var(--color-surface-2)] text-[color:var(--color-ink)]'
                : 'text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]',
            ].join(' ')}
            onClick={() => setView('table')}
          >
            Table
          </button>
        </div>
      </div>

      <PipelineStrip pipeline={pipeline()} />

      <Show when={view() === 'agenda'} fallback={
        <TableView quotes={props.quotes} />
      }>
        <div class="mt-8 space-y-8">
          <Show when={buckets().today.length > 0}>
            <Group
              title="Today"
              subtitle="On the table right now."
              quotes={buckets().today}
              onAction={openDrawer}
            />
          </Show>

          <Show when={buckets().thisWeek.length > 0}>
            <Group
              title="This week"
              subtitle="Recently sent — no movement yet."
              quotes={buckets().thisWeek}
              onAction={openDrawer}
            />
          </Show>

          <Show when={buckets().coolingOff.length > 0}>
            <Group
              title="Cooling off"
              subtitle="No movement in 2+ weeks — try a different angle or close the loop."
              quotes={buckets().coolingOff}
              onAction={openDrawer}
            />
          </Show>

          <Show when={buckets().later.length > 0}>
            <Group
              title="Later"
              subtitle="Sent within the last two weeks."
              quotes={buckets().later}
              onAction={openDrawer}
            />
          </Show>

          <Show when={buckets().decided.length > 0}>
            <DecidedGroup quotes={buckets().decided} />
          </Show>

          <Show when={
            buckets().today.length === 0 &&
            buckets().thisWeek.length === 0 &&
            buckets().coolingOff.length === 0 &&
            buckets().later.length === 0 &&
            buckets().decided.length === 0
          }>
            <ColdStartEmpty />
          </Show>

          <Show when={
            buckets().today.length === 0 &&
            buckets().thisWeek.length === 0 &&
            (buckets().later.length > 0 || buckets().decided.length > 0)
          }>
            <div class="text-center py-8 italic font-serif text-[color:var(--color-muted)]">
              Nothing here. Quiet is good.
            </div>
          </Show>
        </div>
      </Show>

      <ReplyNudgeDrawer
        open={!!drawerMode()}
        onClose={closeDrawer}
        mode={drawerMode() ?? 'reply'}
        quote={drawerQuote()}
      />
    </div>
  );
}

function Group(p: {
  title: string;
  subtitle: string;
  quotes: AgendaQuote[];
  onAction: (mode: 'reply' | 'nudge', q: AgendaQuote) => void;
}) {
  return (
    <section role="region" aria-labelledby={`agenda-${p.title.replace(/\s+/g, '-').toLowerCase()}`}>
      <div class="flex items-baseline justify-between mb-3">
        <h2
          id={`agenda-${p.title.replace(/\s+/g, '-').toLowerCase()}`}
          class="font-serif text-[20px] font-medium"
        >
          {p.title}
          <span class="ml-2 font-mono text-[12px] text-[color:var(--color-muted)] font-normal tabular-nums">
            {p.quotes.length}
          </span>
        </h2>
        <span class="text-sm text-[color:var(--color-muted)] italic font-serif">{p.subtitle}</span>
      </div>
      <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-line)]">
        <For each={p.quotes}>
          {(q) => <Row q={q} onAction={p.onAction} />}
        </For>
      </div>
    </section>
  );
}

function Row(p: { q: AgendaQuote; onAction: (mode: 'reply' | 'nudge', q: AgendaQuote) => void }) {
  const next = () =>
    p.q.state === 'RESPONDED' || p.q.state === 'AWAITING' ? 'reply' : 'nudge';
  const nextLabel = () => (next() === 'reply' ? 'Reply' : 'Nudge');

  return (
    <div class="px-4 py-3.5 flex items-center gap-4 hover:bg-[color:var(--color-surface-2)] transition-colors">
      <StatusPill state={p.q.state} size="sm" />
      <a
        href={`/quotes/${p.q.id}`}
        class="flex-1 min-w-0 hover:no-underline focus:outline-none"
      >
        <div class="flex items-baseline gap-2">
          <span class="font-medium text-sm truncate">{p.q.client_name}</span>
          <span class="text-[color:var(--color-muted-2)] text-xs font-mono">{p.q.ref}</span>
        </div>
        <div class="text-xs text-[color:var(--color-muted)] mt-0.5 truncate">
          {p.q.project_title}
        </div>
        <Show when={p.q.next_step}>
          <div class="mt-1 text-xs italic font-serif text-[color:var(--color-ink-2)] truncate">
            → {p.q.next_step}
          </div>
        </Show>
      </a>
      <div class="text-right">
        <div class="font-mono tabular-nums text-sm font-medium">
          {fmtCurrencyCompact(p.q.total)}
        </div>
        <div class="text-[11px] font-mono text-[color:var(--color-muted)] mt-0.5">
          {fmtAge(p.q.age_days)}
        </div>
      </div>
      <Button size="sm" variant="default" onClick={() => p.onAction(next(), p.q)}>
        {nextLabel()}
      </Button>
    </div>
  );
}

function DecidedGroup(p: { quotes: AgendaQuote[] }) {
  const [expanded, setExpanded] = createSignal(false);
  const won = p.quotes.filter((q) => q.state === 'WON').length;
  const lost = p.quotes.filter((q) => q.state === 'LOST').length;
  return (
    <section>
      <button
        class="w-full flex items-baseline justify-between mb-3 hover:text-[color:var(--color-accent)]"
        onClick={() => setExpanded(!expanded())}
        aria-expanded={expanded()}
      >
        <h2 class="font-serif text-[20px] font-medium">
          Decided
          <span class="ml-2 font-mono text-[12px] text-[color:var(--color-muted)] font-normal">
            {won} won · {lost} lost
          </span>
        </h2>
        <span class="text-xs text-[color:var(--color-muted)]" aria-hidden="true">
          {expanded() ? '▾' : '▸'}
        </span>
      </button>
      <Show when={expanded()}>
        <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] divide-y divide-[color:var(--color-line)]">
          <For each={p.quotes}>
            {(q) => (
              <a
                href={`/quotes/${q.id}`}
                class="block px-4 py-3 hover:bg-[color:var(--color-surface-2)] transition-colors text-sm"
              >
                <div class="flex items-center gap-4">
                  <StatusPill state={q.state} size="sm" />
                  <div class="flex-1 min-w-0">
                    <span class="font-medium">{q.client_name}</span>
                    <span class="ml-2 text-xs text-[color:var(--color-muted)] font-mono">{q.ref}</span>
                  </div>
                  <span class="font-mono tabular-nums text-[color:var(--color-muted)]">
                    {fmtCurrencyCompact(q.total)}
                  </span>
                </div>
              </a>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function pipelineByState(quotes: AgendaQuote[]): Record<QuoteState, { value: number; count: number }> {
  const out: Record<string, { value: number; count: number }> = {};
  for (const q of quotes) {
    if (!out[q.state]) out[q.state] = { value: 0, count: 0 };
    out[q.state].value += q.total;
    out[q.state].count += 1;
  }
  return out as Record<QuoteState, { value: number; count: number }>;
}

function PipelineStrip(props: { pipeline: Record<QuoteState, { value: number; count: number }> }) {
  const segments: Array<{ state: QuoteState; label: string }> = [
    { state: 'DRAFT', label: 'Draft' },
    { state: 'SENT', label: 'Sent' },
    { state: 'AWAITING', label: 'Awaiting' },
    { state: 'RESPONDED', label: 'Responded' },
  ];
  const total = segments.reduce((s, seg) => s + (props.pipeline[seg.state]?.value ?? 0), 0);

  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-4">
      <div class="flex h-2 rounded-full overflow-hidden mb-3" aria-label="Pipeline by state">
        <For each={segments}>
          {(seg) => {
            const val = props.pipeline[seg.state]?.value ?? 0;
            const pct = total > 0 ? (val / total) * 100 : 25;
            return (
              <div
                class={[
                  'h-full',
                  seg.state === 'DRAFT' ? 'bg-[color:var(--color-muted-2)]' : '',
                  seg.state === 'SENT' ? 'bg-[color:var(--color-info)]' : '',
                  seg.state === 'AWAITING' ? 'bg-[color:var(--color-warn)]' : '',
                  seg.state === 'RESPONDED' ? 'bg-[color:var(--color-accent)]' : '',
                ].join(' ')}
                style={{ width: `${total > 0 ? pct : 25}%`, 'min-width': '4px' }}
                title={`${seg.label}: ${fmtCurrencyFull(val)}`}
              />
            );
          }}
        </For>
      </div>
      <div class="grid grid-cols-4 gap-4 text-sm">
        <For each={segments}>
          {(seg) => {
            const data = props.pipeline[seg.state] ?? { value: 0, count: 0 };
            return (
              <div>
                <StatusPill state={seg.state} size="sm" />
                <div class="mt-1 font-serif text-[18px] font-medium tabular-nums">
                  {fmtCurrencyCompact(data.value)}
                </div>
                <div class="text-xs text-[color:var(--color-muted)] mt-0.5">
                  {data.count} {data.count === 1 ? 'quote' : 'quotes'}
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function TableView(p: { quotes: AgendaQuote[] }) {
  return (
    <div class="mt-6 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
      <table class="w-full">
        <thead class="bg-[color:var(--color-surface-2)]">
          <tr>
            <th class="px-3.5 py-3 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Client</th>
            <th class="px-3.5 py-3 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Project</th>
            <th class="px-3.5 py-3 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">State</th>
            <th class="px-3.5 py-3 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Total</th>
            <th class="px-3.5 py-3 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Age</th>
          </tr>
        </thead>
        <tbody>
          <For each={p.quotes}>
            {(q) => (
              <tr
                onClick={() => (window.location.href = `/quotes/${q.id}`)}
                class="border-t border-[color:var(--color-line)] hover:bg-[color:var(--color-surface-2)] cursor-pointer"
              >
                <td class="px-3.5 py-3 text-sm">
                  <div class="font-medium">{q.client_name}</div>
                  <div class="text-xs text-[color:var(--color-muted)] font-mono mt-0.5">{q.ref}</div>
                </td>
                <td class="px-3.5 py-3 text-sm">{q.project_title}</td>
                <td class="px-3.5 py-3"><StatusPill state={q.state} size="sm" /></td>
                <td class="px-3.5 py-3 text-right text-sm font-mono tabular-nums">
                  {fmtCurrencyFull(q.total)}
                </td>
                <td class="px-3.5 py-3 text-right text-xs font-mono text-[color:var(--color-muted)] tabular-nums">
                  {fmtAge(q.age_days)}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function ColdStartEmpty() {
  return (
    <div class="mx-auto max-w-[480px] text-center py-12 px-6">
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-2">
        Cold start
      </div>
      <h2 class="font-serif text-[24px] font-medium leading-tight">No quotes yet.</h2>
      <p class="mt-3 text-sm text-[color:var(--color-muted)] leading-relaxed">
        The fastest way to start is to upload one you sent recently. Brief reads it, learns your voice, and gets ready for the next one.
      </p>
      <div class="mt-6 flex items-center justify-center gap-2">
        <a
          href="/generate"
          class="inline-flex items-center px-4 py-2 rounded-lg bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] text-sm font-medium hover:brightness-95"
        >
          Produce your first quote →
        </a>
      </div>
    </div>
  );
}
