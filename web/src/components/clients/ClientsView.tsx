/**
 * <ClientsView> — sortable table + right-rail detail panel.
 *
 * Click a row → opens the detail panel with avatar, contact, jobs/win-rate/
 * lifetime/last-job blocks, and recent quotes feed. Mirrors
 * design/mockups/03-empty.png.
 */
import { createSignal, For, Show, createMemo } from 'solid-js';
import Pill from '@/components/ui/Pill';
import StatusPill, { type QuoteState } from '@/components/ui/StatusPill';
import { fmtCurrencyCompact, fmtCurrencyFull, fmtRelativeDate } from '@/lib/quote-helpers';

export interface ClientRow {
  id: string;
  name: string;
  type: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  address_line: string | null;
  city: string | null;
  state_code: string | null;
  notes: string | null;
  total_quoted: number;
  total_won: number;
  win_rate_pct: number | null;
  last_activity_at: string | null;
  /** Server-side rollups for the detail panel. */
  n_jobs: number;
  n_won: number;
  n_lost: number;
  recent_quotes: Array<{
    id: string;
    ref: string;
    state: QuoteState;
    project_title: string;
    total: number;
  }>;
}

interface Props {
  clients: ClientRow[];
  /** Shop-level win rate average — used in the "vs. X% shop avg" footnote. */
  shop_avg_win_rate: number | null;
}

const SEGMENT_LABEL: Record<string, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  gc: 'GC',
  public: 'Public',
};

export default function ClientsView(props: Props) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const selected = createMemo(() => props.clients.find((c) => c.id === selectedId()) ?? null);
  const close = () => setSelectedId(null);

  const showDetail = createMemo(() => selected() !== null);

  return (
    <div class={['grid gap-6 transition-[grid-template-columns] duration-200', showDetail() ? 'grid-cols-[1fr_360px]' : 'grid-cols-1'].join(' ')}>
      <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
        <table class="w-full">
          <thead class="bg-[color:var(--color-surface-2)]">
            <tr>
              <th class="px-3.5 py-3 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Client</th>
              <th class="px-3.5 py-3 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Segment</th>
              <th class="px-3.5 py-3 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Jobs</th>
              <th class="px-3.5 py-3 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Win rate</th>
              <Show when={!showDetail()}>
                <th class="px-3.5 py-3 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Lifetime</th>
                <th class="px-3.5 py-3 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Last job</th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={props.clients}>
              {(c) => (
                <tr
                  onClick={() => setSelectedId(c.id)}
                  class={[
                    'border-t border-[color:var(--color-line)] cursor-pointer hover:bg-[color:var(--color-surface-2)] transition-colors',
                    selectedId() === c.id ? 'bg-[color:var(--color-surface-2)]' : '',
                  ].join(' ')}
                >
                  <td class="px-3.5 py-3 text-sm">
                    <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded-full bg-[color:var(--color-bg-2)] grid place-items-center text-[11px] font-serif font-semibold text-[color:var(--color-ink-2)] shrink-0">
                        {avatarFor(c.name)}
                      </div>
                      <div class="min-w-0">
                        <div class="font-medium truncate">{c.name}</div>
                        {c.primary_contact_name && (
                          <div class="text-xs text-[color:var(--color-muted)] mt-0.5 truncate">
                            {c.primary_contact_name}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td class="px-3.5 py-3">
                    {c.type ? (
                      <Pill tone={c.type === 'gc' || c.type === 'commercial' || c.type === 'residential' ? 'good' : 'neutral'} dot={false} size="sm">
                        {SEGMENT_LABEL[c.type] ?? c.type}
                      </Pill>
                    ) : (
                      <span class="text-xs text-[color:var(--color-muted-2)]">—</span>
                    )}
                  </td>
                  <td class="px-3.5 py-3 text-right text-sm font-mono tabular-nums">
                    {c.n_jobs > 0 ? c.n_jobs : '—'}
                  </td>
                  <td class="px-3.5 py-3 text-right text-sm font-mono tabular-nums">
                    {c.win_rate_pct != null ? `${Number(c.win_rate_pct).toFixed(0)}%` : '—'}
                  </td>
                  <Show when={!showDetail()}>
                    <td class="px-3.5 py-3 text-right text-sm font-mono tabular-nums">
                      {fmtCurrencyCompact(Number(c.total_quoted ?? 0))}
                    </td>
                    <td class="px-3.5 py-3 text-right text-xs text-[color:var(--color-muted)] font-mono">
                      {fmtRelativeDate(c.last_activity_at)}
                    </td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      <Show when={selected()}>
        {(client) => <DetailPanel client={client()} shopAvg={props.shop_avg_win_rate} onClose={close} />}
      </Show>
    </div>
  );
}

function DetailPanel(p: { client: ClientRow; shopAvg: number | null; onClose: () => void }) {
  return (
    <aside
      class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5 sticky top-6 self-start"
      aria-label="Client detail"
    >
      <div class="flex items-start gap-2">
        <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] flex-1">
          Client
        </div>
        <button
          type="button"
          aria-label="Close detail"
          onClick={p.onClose}
          class="-mr-1 -mt-1 p-1 text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] rounded"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
          </svg>
        </button>
      </div>

      <div class="mt-3 flex items-start gap-3">
        <div class="w-11 h-11 rounded-full bg-[color:var(--color-bg-2)] grid place-items-center text-[14px] font-serif font-semibold text-[color:var(--color-ink-2)] shrink-0">
          {avatarFor(p.client.name)}
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-serif text-[17px] font-medium leading-tight">{p.client.name}</div>
          <Show when={p.client.primary_contact_name}>
            <div class="text-[12.5px] text-[color:var(--color-muted)] mt-0.5">
              {p.client.primary_contact_name}
            </div>
          </Show>
        </div>
        <Show when={p.client.type}>
          <Pill
            tone={p.client.type === 'gc' || p.client.type === 'commercial' || p.client.type === 'residential' ? 'good' : 'neutral'}
            dot={false}
            size="sm"
          >
            {SEGMENT_LABEL[p.client.type!] ?? p.client.type!}
          </Pill>
        </Show>
      </div>

      <div class="mt-5 grid grid-cols-2 gap-x-5 gap-y-4">
        <Block label="Jobs" value={`${p.client.n_jobs > 0 ? p.client.n_jobs : '—'}`} sub={`${p.client.n_won} won · ${p.client.n_lost} lost`} />
        <Block
          label="Win rate"
          value={p.client.win_rate_pct != null ? `${Number(p.client.win_rate_pct).toFixed(0)}%` : '—'}
          sub={
            p.shopAvg != null && p.client.win_rate_pct != null
              ? `vs. ${Math.round(p.shopAvg)}% shop avg`
              : 'needs ≥3 closed'
          }
        />
        <Block label="Lifetime" value={fmtCurrencyCompact(Number(p.client.total_quoted ?? 0))} sub={`${fmtCurrencyCompact(Number(p.client.total_won ?? 0))} won`} />
        <Block label="Last job" value={fmtRelativeDate(p.client.last_activity_at)} />
      </div>

      <Show when={p.client.recent_quotes.length > 0}>
        <div class="mt-6">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-2">
            Recent quotes
          </div>
          <ol class="divide-y divide-[color:var(--color-line)] border border-[color:var(--color-line)] rounded-lg overflow-hidden">
            <For each={p.client.recent_quotes}>
              {(q) => (
                <li>
                  <a
                    href={`/quotes/${q.id}`}
                    class="block px-3 py-2.5 hover:bg-[color:var(--color-surface-2)]"
                  >
                    <div class="flex items-center gap-2">
                      <StatusPill state={q.state} size="sm" />
                      <span class="text-[11px] font-mono text-[color:var(--color-muted-2)]">{q.ref}</span>
                    </div>
                    <div class="text-sm mt-1 truncate">{q.project_title}</div>
                    <div class="text-[11.5px] font-mono tabular-nums text-[color:var(--color-muted)] mt-0.5">
                      {fmtCurrencyFull(Number(q.total))}
                    </div>
                  </a>
                </li>
              )}
            </For>
          </ol>
        </div>
      </Show>

      <Show when={p.client.notes}>
        <div class="mt-6">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-2">
            Notes
          </div>
          <p class="text-[13px] font-serif italic leading-relaxed text-[color:var(--color-ink-2)] whitespace-pre-wrap">
            {p.client.notes}
          </p>
        </div>
      </Show>
    </aside>
  );
}

function Block(p: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
        {p.label}
      </div>
      <div class="mt-1 font-serif text-[20px] font-medium tabular-nums leading-none">
        {p.value}
      </div>
      <Show when={p.sub}>
        <div class="text-[11px] font-mono text-[color:var(--color-muted-2)] mt-1">
          {p.sub}
        </div>
      </Show>
    </div>
  );
}

function avatarFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z &]/g, '').trim();
  if (cleaned.includes('&')) {
    // "Halsted & Sons" → "H&"
    return cleaned.split(/\s+/)[0].charAt(0).toUpperCase() + '&';
  }
  const words = cleaned.split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
