/**
 * <JobsView> — split layout: list left, detail right.
 *
 * Click a job row → loads the detail panel. <CostReconciliation>
 * lets the user inline-edit actuals; PATCH /api/job/cost-line/:id
 * recomputes totals server-side via the refresh_job_totals trigger.
 */
import { createSignal, For, Show, createMemo, createResource } from 'solid-js';
import { fmtCurrencyFull } from '@/lib/quote-helpers';
import StatusPill, { type JobState } from '@/components/ui/StatusPill';
import Pill from '@/components/ui/Pill';

interface JobRow {
  id: string;
  ref: string;
  client_name: string;
  project_title: string;
  state: JobState;
  scheduled_start: string | null;
  actual_start: string | null;
  scheduled_end: string | null;
  actual_end: string | null;
  estimated_total: number;
  actual_total: number;
  variance: number;
  variance_pct: number | null;
  payroll_synced_at: string | null;
}

interface CostLine {
  id: string;
  category: string;
  description: string;
  estimated: number;
  actual: number | null;
  source: string | null;
}

interface Props {
  jobs: JobRow[];
}

async function loadCostLines(jobId: string): Promise<CostLine[]> {
  const resp = await fetch(`/api/job/${jobId}/cost-lines`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export default function JobsView(props: Props) {
  const [selectedId, setSelectedId] = createSignal<string | null>(props.jobs[0]?.id ?? null);
  const selected = createMemo(() => props.jobs.find((j) => j.id === selectedId()) ?? null);
  const [costLines] = createResource(selectedId, (id) => (id ? loadCostLines(id) : Promise.resolve([])));

  const updateActual = async (lineId: string, value: number) => {
    await fetch(`/api/job/cost-line/${lineId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actual: value, source: 'manual' }),
    });
    // Toggle the resource key off + back on so it refetches.
    const id = selectedId();
    if (id) {
      setSelectedId(null);
      queueMicrotask(() => setSelectedId(id));
    }
  };

  return (
    <div>
      <div class="mb-6">
        <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-1">
          Jobs · Reconciliation
        </div>
        <h1 class="font-serif text-[28px] font-medium leading-tight">
          Did the job land where we bid it?
        </h1>
      </div>

      <Show when={props.jobs.length === 0}>
        <EmptyJobs />
      </Show>

      <Show when={props.jobs.length > 0}>
        <div class="grid grid-cols-[320px_1fr] gap-6">
          <nav aria-label="Jobs">
            <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
              <For each={props.jobs}>
                {(j) => (
                  <button
                    onClick={() => setSelectedId(j.id)}
                    class={[
                      'block w-full text-left px-4 py-3 border-b last:border-b-0 border-[color:var(--color-line)]',
                      'hover:bg-[color:var(--color-surface-2)] transition-colors',
                      selectedId() === j.id ? 'bg-[color:var(--color-surface-2)]' : '',
                    ].join(' ')}
                  >
                    <div class="flex items-center gap-2 mb-1">
                      <StatusPill state={j.state} size="sm" />
                      <span class="text-xs text-[color:var(--color-muted-2)] font-mono">{j.ref}</span>
                    </div>
                    <div class="font-medium text-sm truncate">{j.project_title}</div>
                    <div class="text-xs text-[color:var(--color-muted)] mt-0.5 truncate">
                      {j.client_name}
                    </div>
                    <div class="text-xs font-mono text-[color:var(--color-muted-2)] mt-1.5">
                      Estimated: {fmtCurrencyFull(j.estimated_total)}
                    </div>
                  </button>
                )}
              </For>
            </div>
          </nav>

          <main>
            <Show when={selected()} fallback={
              <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-8 text-sm italic font-serif text-[color:var(--color-muted)] text-center">
                Pick a job from the list.
              </div>
            }>
              <Detail
                job={selected()!}
                costLines={() => costLines() ?? []}
                onUpdate={updateActual}
              />
            </Show>
          </main>
        </div>
      </Show>
    </div>
  );
}

function Detail(p: {
  job: JobRow;
  costLines: () => CostLine[];
  onUpdate: (lineId: string, value: number) => void;
}) {
  const totalActual = createMemo(() =>
    p.costLines().reduce((s, c) => s + Number(c.actual ?? 0), 0),
  );
  const variance = createMemo(() => totalActual() - p.job.estimated_total);
  const variancePct = createMemo(() =>
    p.job.estimated_total > 0 ? (variance() / p.job.estimated_total) * 100 : null,
  );
  const varColor = () => {
    const v = variancePct();
    if (v === null) return 'text-[color:var(--color-muted)]';
    if (v < 0) return 'text-[color:var(--color-good)]';
    if (v > 20) return 'text-[color:var(--color-danger)]';
    if (v > 5) return 'text-[color:var(--color-warn)]';
    return 'text-[color:var(--color-ink)]';
  };

  return (
    <div>
      <div class="flex items-center gap-3">
        <span class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">{p.job.ref}</span>
        <StatusPill state={p.job.state} />
        <Show when={!p.job.payroll_synced_at && p.job.state !== 'CLOSED'}>
          <Pill tone="warn" dot={false}>Payroll not synced</Pill>
        </Show>
      </div>
      <h2 class="mt-2 font-serif text-[24px] font-medium leading-tight">
        {p.job.project_title}
      </h2>
      <p class="text-sm text-[color:var(--color-muted)] mt-1">
        {p.job.client_name}
        {p.job.scheduled_start && ` · ${new Date(p.job.scheduled_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        {p.job.scheduled_end && ` → ${new Date(p.job.scheduled_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
      </p>

      <div class="mt-6 grid grid-cols-3 gap-3">
        <Tile label="Estimated" value={fmtCurrencyFull(p.job.estimated_total)} />
        <Tile label="Actual" value={fmtCurrencyFull(totalActual())} />
        <Tile
          label="Variance"
          value={`${variance() >= 0 ? '+' : '−'}${fmtCurrencyFull(Math.abs(variance()))}`}
          sub={variancePct() !== null ? `${variancePct()! >= 0 ? '+' : ''}${variancePct()!.toFixed(1)}%` : '—'}
          valueClass={varColor()}
        />
      </div>

      <div class="mt-6 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
        <table class="w-full">
          <thead class="bg-[color:var(--color-surface-2)]">
            <tr>
              <th class="px-3.5 py-2.5 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Description</th>
              <th class="px-3.5 py-2.5 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Source</th>
              <th class="px-3.5 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Estimated</th>
              <th class="px-3.5 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Actual</th>
              <th class="px-3.5 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Variance</th>
            </tr>
          </thead>
          <tbody>
            <For each={p.costLines()}>
              {(line) => {
                const lv = (line.actual ?? 0) - line.estimated;
                const lvPct = line.estimated > 0 ? (lv / line.estimated) * 100 : null;
                return (
                  <tr class="border-t border-[color:var(--color-line)]">
                    <td class="px-3.5 py-3 text-sm">
                      <div>{line.description}</div>
                      <div class="text-xs text-[color:var(--color-muted)] mt-0.5 capitalize">{line.category}</div>
                    </td>
                    <td class="px-3.5 py-3 text-xs text-[color:var(--color-muted)] uppercase font-mono">
                      {line.source ?? '—'}
                    </td>
                    <td class="px-3.5 py-3 text-right text-sm font-mono tabular-nums">
                      {fmtCurrencyFull(line.estimated)}
                    </td>
                    <td class="px-3.5 py-3 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={line.actual ?? ''}
                        placeholder="—"
                        onBlur={(e) => {
                          const v = parseFloat(e.currentTarget.value);
                          if (!isNaN(v)) p.onUpdate(line.id, v);
                        }}
                        class="w-28 text-right bg-transparent border-0 outline-none px-1 py-1 tabular-nums font-mono text-sm focus:bg-[color:var(--color-surface-2)] rounded"
                      />
                    </td>
                    <td class={['px-3.5 py-3 text-right text-sm font-mono tabular-nums', lvPct === null ? '' :
                      lvPct < 0 ? 'text-[color:var(--color-good)]' :
                      lvPct > 20 ? 'text-[color:var(--color-danger)]' :
                      lvPct > 5 ? 'text-[color:var(--color-warn)]' : 'text-[color:var(--color-ink)]'].join(' ')}>
                      <Show when={lvPct !== null} fallback={'—'}>
                        {lvPct! >= 0 ? '+' : '−'}{Math.abs(lvPct!).toFixed(1)}%
                      </Show>
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile(p: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-4">
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">{p.label}</div>
      <div class={['mt-1 font-serif text-[20px] font-medium tabular-nums', p.valueClass ?? ''].join(' ')}>
        {p.value}
      </div>
      <Show when={p.sub}>
        <div class={['text-xs font-mono mt-0.5', p.valueClass ?? 'text-[color:var(--color-muted)]'].join(' ')}>
          {p.sub}
        </div>
      </Show>
    </div>
  );
}

function EmptyJobs() {
  // Per design/mockups/01-list-detail.png — editorial empty card with
  // page-level H1 ("Did the job land where we bid it?") sitting above.
  return (
    <article class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-10 sm:p-14 max-w-[760px]">
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-3">
        Jobs · Empty
      </div>
      <h2 class="font-serif text-[32px] sm:text-[40px] font-medium leading-tight">
        Nothing on the schedule.
      </h2>
      <p class="mt-4 text-[15px] text-[color:var(--color-ink-2)] leading-relaxed font-serif max-w-[55ch]">
        A job opens when a client signs. From there Brief tracks labor against bid, materials against bid, schedule against promise — and tells you, gently, when the variance starts to add up.
      </p>
      <div class="mt-7">
        <a
          href="/generate"
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] text-sm font-medium hover:brightness-95"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M7 2.5v9M2.5 7h9" /></svg>
          New quote
        </a>
      </div>
    </article>
  );
}
