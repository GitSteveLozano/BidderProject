/**
 * <JobsView> — split layout: list left, detail right.
 *
 * Click a job row → loads the detail panel. <CostReconciliation>
 * lets the user inline-edit actuals; PATCH /api/job/cost-line/:id
 * recomputes totals server-side via the refresh_job_totals trigger.
 */
import { createSignal, For, Show, createMemo, createResource } from 'solid-js';
import { isServer } from 'solid-js/web';
import { fmtCurrencyFull } from '@/lib/quote-helpers';
import StatusPill, { type JobState } from '@/components/ui/StatusPill';
import Pill from '@/components/ui/Pill';
import JobActionDrawer, { type JobActionMode } from '@/components/jobs/JobActionDrawer';
import ChangeOrders from '@/components/jobs/ChangeOrders';

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
  /** Sum of APPROVED change orders against this job. Maintained by
   * trigger when COs flip state — see migration 006. */
  change_order_total: number;
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
  /** Shop-level default margin %; used as fallback for change-order
   * lines that don't have an override. */
  shop_default_margin_pct: number;
}

async function loadCostLines(jobId: string): Promise<CostLine[]> {
  const resp = await fetch(`/api/job/${jobId}/cost-lines`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export default function JobsView(props: Props) {
  const [selectedId, setSelectedId] = createSignal<string | null>(props.jobs[0]?.id ?? null);
  const selected = createMemo(() => props.jobs.find((j) => j.id === selectedId()) ?? null);
  // Source returns null on the SSR pass so the fetcher never fires
  // server-side — Cloudflare Worker's fetch rejects relative URLs, and
  // /api/job/[id]/cost-lines is relative. On the client the source
  // returns selectedId(); falsy selectedId skips the fetcher too,
  // which gives us a clean empty state on jobs-list pages.
  const [costLines] = createResource(
    () => (isServer ? null : selectedId()),
    (id) => loadCostLines(id),
  );
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [drawerMode, setDrawerMode] = createSignal<JobActionMode>('update');
  const openDrawer = (mode: JobActionMode) => {
    setDrawerMode(mode);
    setDrawerOpen(true);
  };

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
        <div class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
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
                onAction={openDrawer}
                shop_default_margin_pct={props.shop_default_margin_pct}
              />
            </Show>
          </main>
        </div>
      </Show>

      <JobActionDrawer
        open={drawerOpen()}
        onClose={() => setDrawerOpen(false)}
        mode={drawerMode()}
        job={
          selected()
            ? {
                id: selected()!.id,
                ref: selected()!.ref,
                project_title: selected()!.project_title,
                client_name: selected()!.client_name,
                state: selected()!.state as 'SCHEDULED' | 'INPROGRESS' | 'CLOSED',
                variance_pct: selected()!.variance_pct,
                scheduled_start: selected()!.scheduled_start,
                scheduled_end: selected()!.scheduled_end,
              }
            : null
        }
      />
    </div>
  );
}

function Detail(p: {
  job: JobRow;
  costLines: () => CostLine[];
  onUpdate: (lineId: string, value: number) => void;
  onAction: (mode: JobActionMode) => void;
  shop_default_margin_pct: number;
}) {
  const totalActual = createMemo(() =>
    p.costLines().reduce((s, c) => s + Number(c.actual ?? 0), 0),
  );
  // Variance is measured against the CONTRACTED total (original bid +
  // approved change orders). A CO that lands mid-job re-baselines
  // expectations; comparing actuals to the pre-CO bid would
  // misleadingly flag overruns that the client already approved.
  const contractedTotal = createMemo(
    () => p.job.estimated_total + p.job.change_order_total,
  );
  const variance = createMemo(() => totalActual() - contractedTotal());
  const variancePct = createMemo(() =>
    contractedTotal() > 0 ? (variance() / contractedTotal()) * 100 : null,
  );
  const varColor = () => {
    const v = variancePct();
    if (v === null) return 'text-[color:var(--color-muted)]';
    if (v < 0) return 'text-[color:var(--color-good)]';
    if (v > 20) return 'text-[color:var(--color-danger)]';
    if (v > 5) return 'text-[color:var(--color-warn)]';
    return 'text-[color:var(--color-ink)]';
  };
  // Percent complete — derived since the schema doesn't carry it.
  //   CLOSED        → 100%
  //   INPROGRESS    → time-based ratio against the scheduled window,
  //                   clamped to 1..99% so the ring shows the job is
  //                   in motion even when actuals haven't synced yet
  //   SCHEDULED     →   0%
  const pctComplete = createMemo(() => {
    if (p.job.state === 'CLOSED') return 100;
    if (p.job.state === 'SCHEDULED') return 0;
    const start = p.job.actual_start ?? p.job.scheduled_start;
    const end = p.job.scheduled_end;
    if (!start || !end) return 50;
    const t0 = new Date(start).getTime();
    const t1 = new Date(end).getTime();
    if (t1 <= t0) return 50;
    const now = Date.now();
    return Math.max(1, Math.min(99, Math.round(((now - t0) / (t1 - t0)) * 100)));
  });
  // Projected margin = (contracted - projected_actual_total) / contracted * 100,
  // where projected_actual_total scales current actuals to 100% complete.
  // Uses the contracted total so approved COs lift the ceiling.
  const projectedMargin = createMemo(() => {
    if (contractedTotal() <= 0) return null;
    const pct = pctComplete();
    if (pct === 0) return null;
    const projectedTotal = totalActual() / (pct / 100);
    return ((contractedTotal() - projectedTotal) / contractedTotal()) * 100;
  });

  const ranOver = () => (variancePct() ?? 0) > 5;

  return (
    <div>
      {/* Top row: project title + crew/dates on left, status-and-warn pills, progress ring on right */}
      <div class="grid grid-cols-[1fr_auto] gap-6 items-start">
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">{p.job.ref}</span>
            <StatusPill state={p.job.state} size="sm" />
            <Show when={!p.job.payroll_synced_at && p.job.state !== 'CLOSED'}>
              <Pill tone="warn" dot={false} size="sm">Payroll not synced</Pill>
            </Show>
            <Show when={ranOver()}>
              <Pill tone="warn" dot={false} size="sm">Running over</Pill>
            </Show>
          </div>
          <h2 class="font-serif text-[28px] font-medium leading-tight tracking-tight">
            {p.job.project_title}
          </h2>
          <p class="text-[14px] font-serif italic text-[color:var(--color-muted)] mt-1">
            {p.job.client_name}
          </p>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[color:var(--color-muted)]">
            <Show when={p.job.scheduled_start || p.job.actual_start}>
              <span class="inline-flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="2.5" width="9" height="8" rx="1" /><path d="M1.5 5h9M4 1.5v2M8 1.5v2" /></svg>
                {fmtDate(p.job.actual_start ?? p.job.scheduled_start)}
                {p.job.scheduled_end && ` → ${fmtDate(p.job.scheduled_end)}`}
              </span>
            </Show>
          </div>
          <Show when={p.job.state !== 'CLOSED'}>
            <div class="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => p.onAction('update')}
                class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] text-[13px] font-medium hover:brightness-95"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M2 1.5l8.5 4-3.5 1.6-1.6 3.4-3.4-9z" />
                </svg>
                Update client
              </button>
              <button
                type="button"
                onClick={() => p.onAction('check-in')}
                class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] text-[13px] font-medium hover:bg-[color:var(--color-surface-2)]"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="6" cy="6" r="4.5" />
                  <path d="M6 3.5v2.5l1.6 1.1" />
                </svg>
                Schedule check-in
              </button>
            </div>
          </Show>
        </div>
        <ProgressRing percent={pctComplete()} state={p.job.state} />
      </div>

      {/* KPI tiles — Quoted, Actual, Projected margin (mockup 02-cost-recon.png) */}
      <div class="mt-7 grid grid-cols-3 gap-3">
        <Tile
          label="Contracted"
          value={fmtCurrencyFull(p.job.estimated_total + p.job.change_order_total)}
          sub={p.job.change_order_total > 0
            ? `${fmtCurrencyFull(p.job.estimated_total)} bid + ${fmtCurrencyFull(p.job.change_order_total)} change orders`
            : `${fmtCurrencyFull(p.job.estimated_total)} original bid`}
        />
        <Tile
          label={p.job.state === 'CLOSED' ? 'Actual' : 'Actuals so far'}
          value={fmtCurrencyFull(totalActual())}
          sub={variancePct() !== null ? `${variancePct()! >= 0 ? '+' : '−'}${Math.abs(variancePct()!).toFixed(1)}% vs quoted` : undefined}
          valueClass={varColor()}
        />
        <Tile
          label={p.job.state === 'CLOSED' ? 'Delivered margin' : 'Projected margin'}
          value={
            projectedMargin() != null
              ? `${projectedMargin()! >= 0 ? '' : '−'}${Math.abs(projectedMargin()!).toFixed(1)}%`
              : '—'
          }
          sub={p.job.state === 'CLOSED' ? 'Closed' : `at ${pctComplete()}% complete`}
          valueClass={projectedMargin() != null && projectedMargin()! < 15 ? 'text-[color:var(--color-warn)]' : ''}
        />
      </div>

      {/* Reconciliation table */}
      <div class="mt-7 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
        <div class="px-5 py-3.5 border-b border-[color:var(--color-line)] flex items-center gap-2.5">
          <h3 class="font-serif text-base font-medium flex-1">
            Where we landed vs. where we bid
          </h3>
          <span class="text-[11px] font-mono uppercase tracking-wide text-[color:var(--color-muted-2)]">
            Auto-synced from payroll & receipts
          </span>
        </div>
        <div class="overflow-x-auto">
        <table class="w-full min-w-[680px]">
          <thead class="bg-[color:var(--color-surface-2)]">
            <tr>
              <th class="px-4 py-2.5 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Line</th>
              <th class="px-4 py-2.5 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Source</th>
              <th class="px-4 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Quoted</th>
              <th class="px-4 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Actual</th>
              <th class="px-4 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Variance</th>
            </tr>
          </thead>
          <tbody>
            <Show when={p.costLines().length === 0}>
              <tr>
                <td colspan={5} class="px-4 py-6 text-center text-sm italic font-serif text-[color:var(--color-muted)]">
                  No cost lines on this job yet.
                </td>
              </tr>
            </Show>
            <For each={p.costLines()}>
              {(line) => {
                const lv = (line.actual ?? 0) - line.estimated;
                const lvPct = line.estimated > 0 ? (lv / line.estimated) * 100 : null;
                return (
                  <tr class="border-t border-[color:var(--color-line)]">
                    <td class="px-4 py-3 text-sm">
                      <div class="font-medium">{line.description}</div>
                      <div class="text-xs text-[color:var(--color-muted)] mt-0.5 capitalize">{line.category}</div>
                    </td>
                    <td class="px-4 py-3 text-xs text-[color:var(--color-muted)] uppercase font-mono">
                      {line.source ?? '—'}
                    </td>
                    <td class="px-4 py-3 text-right text-sm font-mono tabular-nums">
                      {fmtCurrencyFull(line.estimated)}
                    </td>
                    <td class="px-4 py-3 text-right">
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
                    <td class={['px-4 py-3 text-right text-sm font-mono tabular-nums', lvPct === null ? '' :
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

      <div class="mt-7">
        <ChangeOrders job_id={p.job.id} shop_default_margin_pct={p.shop_default_margin_pct} />
      </div>
    </div>
  );
}

function ProgressRing(p: { percent: number; state: JobState }) {
  // 76px outer, 6px stroke. Ring uses accent for in-progress, good for
  // closed, muted for scheduled (no progress yet).
  const radius = 32;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const dash = (p.percent / 100) * circumference;
  const ringColor = () =>
    p.state === 'CLOSED'
      ? 'var(--color-good)'
      : p.state === 'SCHEDULED'
        ? 'var(--color-muted-2)'
        : 'var(--color-accent)';
  return (
    <div class="relative w-[76px] h-[76px] shrink-0" aria-label={`${p.percent}% complete`}>
      <svg width="76" height="76" viewBox="0 0 76 76" class="-rotate-90">
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke="var(--color-bg-2)"
          stroke-width={stroke}
        />
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke={ringColor()}
          stroke-width={stroke}
          stroke-linecap="round"
          stroke-dasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 400ms ease' }}
        />
      </svg>
      <div class="absolute inset-0 grid place-items-center">
        <div class="text-center">
          <div class="font-serif text-[18px] font-medium tabular-nums leading-none">
            {p.percent}
            <span class="text-[10px] text-[color:var(--color-muted)] ml-0.5">%</span>
          </div>
          <div class="text-[9px] font-mono uppercase tracking-wide text-[color:var(--color-muted-2)] mt-0.5">
            {p.state === 'CLOSED' ? 'Closed' : p.state === 'SCHEDULED' ? 'Scheduled' : 'In progress'}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
