/**
 * <LineItemsTable> — inline-editable line items on the quote detail.
 *
 * Mirrors mockup 04-pricing.png: Description / Qty / Unit / Subtotal /
 * Conf columns with a "+ Add line" button in the header. Editing is
 * allowed only while the quote is in DRAFT; the rendering parent passes
 * `editable={state === 'DRAFT'}` so sent quotes render read-only.
 */
import { createSignal, For, Show, createMemo } from 'solid-js';
import { fmtCurrencyFull } from '@/lib/quote-helpers';
import Pill from '@/components/ui/Pill';

export interface LineItem {
  id: string;
  position: number;
  description: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  subtotal: number;              // cost basis: qty * unit_price
  category: string | null;
  confidence: 'high' | 'med' | 'low' | 'manual' | null;
  /** null = use the quote-level margin. */
  margin_pct: number | null;
}

interface Props {
  quote_id: string;
  initial: LineItem[];
  editable: boolean;
  total: number;
  /** Quote-level fallback margin (quotes.margin_pct). Used as the
   * default when a line item has margin_pct = null. */
  quote_margin_pct: number;
}

const UNITS = ['each', 'hr', 'sqft', 'lf', 'cy', 'day', 'lump_sum'] as const;

export default function LineItemsTable(props: Props) {
  const [rows, setRows] = createSignal<LineItem[]>(
    [...props.initial].sort((a, b) => a.position - b.position),
  );
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal({ description: '', qty: 1, unit: 'each', unit_price: 0, margin_pct: null as number | null });
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Total = sum of (line cost × (1 + effective margin / 100)). Matches
  // the recompute in /api/quote/line-item*.ts so the in-page number
  // stays consistent with what the server persists to quotes.total.
  const total = createMemo(() =>
    rows().reduce((s, r) => {
      const m = r.margin_pct != null ? r.margin_pct : props.quote_margin_pct;
      return s + Number(r.subtotal) * (1 + m / 100);
    }, 0),
  );

  const patch = async (id: string, fields: Partial<LineItem>) => {
    setError(null);
    const before = rows();
    const next = before.map((r) =>
      r.id === id
        ? {
            ...r,
            ...fields,
            subtotal:
              fields.qty != null || fields.unit_price != null
                ? round2(
                    Number(fields.qty ?? r.qty) * Number(fields.unit_price ?? r.unit_price),
                  )
                : r.subtotal,
          }
        : r,
    );
    setRows(next);
    const resp = await fetch(`/api/quote/line-item/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!resp.ok) {
      setError(await resp.text());
      setRows(before);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    const before = rows();
    setRows(before.filter((r) => r.id !== id));
    const resp = await fetch(`/api/quote/line-item/${id}`, { method: 'DELETE' });
    if (!resp.ok) {
      setError(await resp.text());
      setRows(before);
    }
  };

  const submitNew = async () => {
    const d = draft();
    if (!d.description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch('/api/quote/line-item', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quote_id: props.quote_id,
          description: d.description.trim(),
          qty: Number(d.qty),
          unit: d.unit,
          unit_price: Number(d.unit_price),
          confidence: 'manual',
          margin_pct: d.margin_pct,
        }),
      });
      if (!resp.ok) {
        setError(await resp.text());
        return;
      }
      const created: LineItem = await resp.json();
      setRows([...rows(), created]);
      setDraft({ description: '', qty: 1, unit: 'each', unit_price: 0, margin_pct: null as number | null });
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
      <div class="px-5 py-3.5 border-b border-[color:var(--color-line)] flex items-center gap-2.5">
        <h3 class="font-serif text-base font-medium flex-1">Line items</h3>
        <Show when={props.editable}>
          <button
            type="button"
            onClick={() => setAdding(true)}
            class="inline-flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--color-accent)] hover:brightness-95"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            Add line
          </button>
        </Show>
      </div>
      <div class="overflow-x-auto">
      <table class="w-full min-w-[760px]">
        <thead class="bg-[color:var(--color-surface-2)]">
          <tr>
            <th class="px-3.5 py-2.5 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Description</th>
            <th class="px-3.5 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Qty</th>
            <th class="px-3.5 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Unit</th>
            <th class="px-3.5 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Cost</th>
            <th class="px-3.5 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Margin</th>
            <th class="px-3.5 py-2.5 text-right text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Total</th>
            <th class="px-3.5 py-2.5 text-left text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">Conf</th>
            <Show when={props.editable}>
              <th class="px-2 py-2.5 w-8" aria-hidden="true" />
            </Show>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(li) => (
              <tr class="border-t border-[color:var(--color-line)] group">
                <td class="px-3.5 py-2">
                  <Show
                    when={props.editable}
                    fallback={<span class="text-sm">{li.description}</span>}
                  >
                    <input
                      class="w-full bg-transparent text-sm outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1.5 py-1"
                      value={li.description}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim();
                        if (v && v !== li.description) patch(li.id, { description: v });
                      }}
                    />
                  </Show>
                </td>
                <td class="px-3.5 py-2 text-right">
                  <Show
                    when={props.editable}
                    fallback={<span class="text-sm font-mono tabular-nums">{Number(li.qty).toLocaleString()}</span>}
                  >
                    <input
                      type="number"
                      step="0.001"
                      class="w-20 text-right bg-transparent text-sm font-mono tabular-nums outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1.5 py-1"
                      value={li.qty}
                      onBlur={(e) => {
                        const v = parseFloat(e.currentTarget.value);
                        if (!isNaN(v) && v !== li.qty) patch(li.id, { qty: v });
                      }}
                    />
                  </Show>
                </td>
                <td class="px-3.5 py-2 text-right">
                  <Show
                    when={props.editable}
                    fallback={
                      <span class="text-xs font-mono text-[color:var(--color-muted)]">{li.unit ?? ''}</span>
                    }
                  >
                    <select
                      class="bg-transparent text-xs font-mono text-[color:var(--color-muted)] outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1.5 py-1"
                      value={li.unit ?? ''}
                      onChange={(e) => patch(li.id, { unit: e.currentTarget.value || null })}
                    >
                      <option value=""></option>
                      <For each={UNITS}>{(u) => <option value={u}>{u}</option>}</For>
                    </select>
                  </Show>
                </td>
                <td class="px-3.5 py-2 text-right text-sm font-mono tabular-nums">
                  {fmtCurrencyFull(Number(li.subtotal))}
                </td>
                <td class="px-3.5 py-2 text-right">
                  <Show
                    when={props.editable}
                    fallback={
                      <span class="text-sm font-mono tabular-nums text-[color:var(--color-muted)]">
                        {li.margin_pct != null ? `${li.margin_pct.toFixed(0)}%` : `${props.quote_margin_pct.toFixed(0)}%`}
                      </span>
                    }
                  >
                    <input
                      type="number"
                      step="0.5"
                      placeholder={`${props.quote_margin_pct}`}
                      title={li.margin_pct == null ? `Default: ${props.quote_margin_pct}% (quote-level).` : 'Per-line override'}
                      class={[
                        'w-16 text-right bg-transparent text-sm font-mono tabular-nums outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1.5 py-1',
                        li.margin_pct == null ? 'text-[color:var(--color-muted)]' : 'text-[color:var(--color-ink)]',
                      ].join(' ')}
                      value={li.margin_pct ?? ''}
                      onBlur={(e) => {
                        const raw = e.currentTarget.value;
                        const next = raw === '' ? null : parseFloat(raw);
                        if (next !== li.margin_pct) patch(li.id, { margin_pct: next });
                      }}
                    />
                  </Show>
                </td>
                <td class="px-3.5 py-2 text-right text-sm font-mono tabular-nums font-medium">
                  {fmtCurrencyFull(
                    Number(li.subtotal) *
                      (1 + (li.margin_pct != null ? li.margin_pct : props.quote_margin_pct) / 100),
                  )}
                </td>
                <td class="px-3.5 py-2">
                  <ConfPill confidence={li.confidence} />
                </td>
                <Show when={props.editable}>
                  <td class="px-2 py-2 w-8">
                    <button
                      type="button"
                      onClick={() => remove(li.id)}
                      class="opacity-0 group-hover:opacity-100 transition-opacity text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] p-1"
                      aria-label="Delete line"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                        <path d="M2.5 3.5h7M5 5.5v3M7 5.5v3M3.5 3.5l.5 6.5h4l.5-6.5M4.5 3.5V2h3v1.5" />
                      </svg>
                    </button>
                  </td>
                </Show>
              </tr>
            )}
          </For>

          <Show when={adding()}>
            <tr class="border-t border-[color:var(--color-line)] bg-[color:var(--color-accent-tint)]/30">
              <td class="px-3.5 py-2">
                <input
                  autofocus
                  placeholder="Description (e.g. Prep + lath)"
                  class="w-full bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-sm rounded px-2 py-1.5 outline-none focus:border-[color:var(--color-accent)]"
                  value={draft().description}
                  onInput={(e) => setDraft({ ...draft(), description: e.currentTarget.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNew();
                    if (e.key === 'Escape') setAdding(false);
                  }}
                />
              </td>
              <td class="px-3.5 py-2 text-right">
                <input
                  type="number"
                  step="0.001"
                  class="w-20 text-right bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-sm font-mono rounded px-2 py-1.5 outline-none focus:border-[color:var(--color-accent)]"
                  value={draft().qty}
                  onInput={(e) => setDraft({ ...draft(), qty: parseFloat(e.currentTarget.value) || 0 })}
                />
              </td>
              <td class="px-3.5 py-2 text-right">
                <select
                  class="bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-xs font-mono rounded px-2 py-1.5 outline-none focus:border-[color:var(--color-accent)]"
                  value={draft().unit}
                  onChange={(e) => setDraft({ ...draft(), unit: e.currentTarget.value })}
                >
                  <For each={UNITS}>{(u) => <option value={u}>{u}</option>}</For>
                </select>
              </td>
              <td class="px-3.5 py-2 text-right">
                <input
                  type="number"
                  step="0.01"
                  placeholder="Unit $"
                  class="w-24 text-right bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-sm font-mono rounded px-2 py-1.5 outline-none focus:border-[color:var(--color-accent)]"
                  value={draft().unit_price || ''}
                  onInput={(e) => setDraft({ ...draft(), unit_price: parseFloat(e.currentTarget.value) || 0 })}
                />
              </td>
              <td class="px-3.5 py-2 text-xs text-[color:var(--color-muted)] font-mono text-right">
                {fmtCurrencyFull(round2(Number(draft().qty) * Number(draft().unit_price)))}
              </td>
              <td class="px-3.5 py-2 text-right">
                <input
                  type="number"
                  step="0.5"
                  placeholder={`${props.quote_margin_pct}`}
                  class="w-16 text-right bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-sm font-mono rounded px-2 py-1.5 outline-none focus:border-[color:var(--color-accent)]"
                  value={draft().margin_pct ?? ''}
                  onInput={(e) => {
                    const raw = e.currentTarget.value;
                    setDraft({ ...draft(), margin_pct: raw === '' ? null : parseFloat(raw) });
                  }}
                />
              </td>
              <td class="px-3.5 py-2 text-right text-sm font-mono tabular-nums font-medium">
                {fmtCurrencyFull(
                  round2(
                    Number(draft().qty) *
                      Number(draft().unit_price) *
                      (1 + (draft().margin_pct ?? props.quote_margin_pct) / 100),
                  ),
                )}
              </td>
              <td class="px-2 py-2 flex gap-1">
                <button
                  type="button"
                  onClick={submitNew}
                  disabled={saving() || !draft().description.trim()}
                  class="text-[11px] font-medium px-2 py-1 rounded bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setDraft({ description: '', qty: 1, unit: 'each', unit_price: 0, margin_pct: null as number | null });
                  }}
                  class="text-[11px] text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
                >
                  Cancel
                </button>
              </td>
            </tr>
          </Show>

          <tr class="border-t-2 border-[color:var(--color-ink)] bg-[color:var(--color-surface-2)]">
            <td colspan={5} class="px-3.5 py-3 text-right font-medium">Total</td>
            <td class="px-3.5 py-3 text-right font-serif text-[18px] tabular-nums">
              {fmtCurrencyFull(total())}
            </td>
            <Show when={props.editable}>
              <td colspan={2} />
            </Show>
            <Show when={!props.editable}>
              <td />
            </Show>
          </tr>
        </tbody>
      </table>
      </div>
      <Show when={error()}>
        <div class="px-5 py-2 text-xs text-[color:var(--color-danger)] bg-[color:var(--color-danger-tint)]">
          {error()}
        </div>
      </Show>
    </div>
  );
}

function ConfPill(p: { confidence: LineItem['confidence'] }) {
  const c = p.confidence;
  if (!c) return null;
  const tone = c === 'high' ? 'good' : c === 'med' ? 'info' : c === 'low' ? 'warn' : 'neutral';
  const label = c === 'manual' ? 'Manual' : c === 'high' ? 'High' : c === 'med' ? 'Med' : 'Low';
  return (
    <Pill tone={tone} dot={false} size="sm">
      {label}
    </Pill>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
