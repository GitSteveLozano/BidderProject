/**
 * <ChangeOrders> — change-order management on the Jobs detail panel.
 *
 * Shows existing COs for a job with state pills + per-CO totals. Each
 * CO can be expanded inline to manage line items. State actions
 * (Mark sent / Mark approved / Mark rejected) live in the CO header.
 *
 * Approved COs roll into jobs.change_order_total via DB trigger, so
 * the parent JobsView shows the contracted total = estimated_total +
 * change_order_total after a state flip.
 */
import { createResource, createSignal, For, Show, createMemo } from 'solid-js';
import { isServer } from 'solid-js/web';
import { fmtCurrencyFull } from '@/lib/quote-helpers';
import Pill from '@/components/ui/Pill';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';

type COState = 'PROPOSED' | 'SENT' | 'APPROVED' | 'REJECTED' | 'VOID';

interface COLine {
  id: string;
  position: number;
  description: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  subtotal: number;
  category: string | null;
  margin_pct: number | null;
}

interface CO {
  id: string;
  ref: string;
  title: string;
  reason: string | null;
  state: COState;
  total: number;
  margin_pct: number | null;
  sent_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  change_order_line_items: COLine[];
}

interface Props {
  job_id: string;
  shop_default_margin_pct: number;
}

const TONE_BY_STATE: Record<COState, 'neutral' | 'info' | 'good' | 'warn' | 'danger'> = {
  PROPOSED: 'neutral',
  SENT: 'info',
  APPROVED: 'good',
  REJECTED: 'danger',
  VOID: 'neutral',
};

export default function ChangeOrders(props: Props) {
  const [cos, { mutate, refetch }] = createResource(
    () => (isServer ? null : props.job_id),
    async (id: string | null) => {
      if (!id) return [];
      const resp = await fetch(`/api/job/${id}/change-orders`);
      if (!resp.ok) throw new Error(await resp.text());
      return (await resp.json()) as CO[];
    },
  );

  const [addingNew, setAddingNew] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal('');
  const [newReason, setNewReason] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const createCO = async () => {
    if (!newTitle().trim()) return;
    setCreating(true);
    setError(null);
    try {
      const resp = await fetch(`/api/job/${props.job_id}/change-orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: newTitle().trim(),
          reason: newReason().trim() || null,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const created = (await resp.json()) as CO;
      mutate((prev) => [created, ...(prev ?? [])]);
      setNewTitle('');
      setNewReason('');
      setAddingNew(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const refresh = () => refetch();

  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
      <div class="px-5 py-3.5 border-b border-[color:var(--color-line)] flex items-center gap-2.5">
        <h3 class="font-serif text-base font-medium flex-1">Change orders</h3>
        <span class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
          {(cos() ?? []).length} on this job
        </span>
        <Show when={!addingNew()}>
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            class="inline-flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--color-accent)] hover:brightness-95"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            New change order
          </button>
        </Show>
      </div>

      <Show when={addingNew()}>
        <div class="px-5 py-4 border-b border-[color:var(--color-line)] bg-[color:var(--color-surface-2)]">
          <div class="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
            <Field label="Title">
              <Input
                value={newTitle()}
                onInput={(e) => setNewTitle(e.currentTarget.value)}
                placeholder="Owner added — west wall windows"
              />
            </Field>
            <Field label="Reason (optional)">
              <Input
                value={newReason()}
                onInput={(e) => setNewReason(e.currentTarget.value)}
                placeholder="Found rot during prep / Owner spec change / etc."
              />
            </Field>
          </div>
          <Show when={error()}>
            <div class="mt-2 text-xs text-[color:var(--color-danger)]">{error()}</div>
          </Show>
          <div class="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setAddingNew(false); setError(null); }}>
              Cancel
            </Button>
            <Button variant="accent" disabled={creating() || !newTitle().trim()} onClick={createCO}>
              {creating() ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </Show>

      <Show
        when={(cos() ?? []).length > 0}
        fallback={
          <Show when={!cos.loading && !addingNew()}>
            <div class="px-5 py-6 text-sm italic font-serif text-[color:var(--color-muted)]">
              No change orders yet. When out-of-scope work comes up, add one here
              so the contracted total stays honest.
            </div>
          </Show>
        }
      >
        <ul class="divide-y divide-[color:var(--color-line)]">
          <For each={cos()!}>
            {(co) => (
              <COCard
                co={co}
                shop_default_margin_pct={props.shop_default_margin_pct}
                onChange={refresh}
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function COCard(props: { co: CO; shop_default_margin_pct: number; onChange: () => void }) {
  const [expanded, setExpanded] = createSignal(props.co.state === 'PROPOSED');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const editable = () => props.co.state === 'PROPOSED';
  const lines = () => (props.co.change_order_line_items ?? []).slice().sort((a, b) => a.position - b.position);

  const transition = async (state: COState, rejected_reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/change-order/${props.co.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state, rejected_reason }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      props.onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const askReject = async () => {
    const reason = prompt('Why was this change order rejected? (optional)') ?? '';
    await transition('REJECTED', reason);
  };

  return (
    <li class="px-5 py-3.5">
      <div class="flex items-baseline gap-2.5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          class="font-mono text-[12px] tracking-[0.06em] text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
        >
          {expanded() ? '▾' : '▸'} {props.co.ref}
        </button>
        <Pill tone={TONE_BY_STATE[props.co.state]} size="sm" dot={false}>
          {props.co.state}
        </Pill>
        <span class="font-medium text-sm truncate flex-1">{props.co.title}</span>
        <span class="font-mono text-sm tabular-nums">
          {fmtCurrencyFull(Number(props.co.total))}
        </span>
      </div>
      <Show when={props.co.reason}>
        <div class="mt-1 text-[12.5px] italic font-serif text-[color:var(--color-muted)] leading-relaxed">
          {props.co.reason}
        </div>
      </Show>
      <Show when={props.co.rejected_reason && props.co.state === 'REJECTED'}>
        <div class="mt-1 text-[12.5px] italic font-serif text-[color:var(--color-danger)] leading-relaxed">
          Rejected: {props.co.rejected_reason}
        </div>
      </Show>

      <Show when={expanded()}>
        <div class="mt-3">
          <COLines
            co_id={props.co.id}
            editable={editable()}
            initialLines={lines()}
            fallback_margin_pct={
              props.co.margin_pct != null ? props.co.margin_pct : props.shop_default_margin_pct
            }
            onMutated={props.onChange}
          />
          <div class="mt-3 flex items-center gap-2">
            <Show when={props.co.state === 'PROPOSED'}>
              <Button size="sm" variant="default" disabled={busy()} onClick={() => transition('SENT')}>
                Mark sent
              </Button>
              <Button size="sm" variant="accent" disabled={busy()} onClick={() => transition('APPROVED')}>
                Mark approved
              </Button>
              <Button size="sm" variant="ghost" disabled={busy()} onClick={askReject}>
                Mark rejected
              </Button>
            </Show>
            <Show when={props.co.state === 'SENT'}>
              <Button size="sm" variant="accent" disabled={busy()} onClick={() => transition('APPROVED')}>
                Mark approved
              </Button>
              <Button size="sm" variant="ghost" disabled={busy()} onClick={askReject}>
                Mark rejected
              </Button>
            </Show>
            <Show when={props.co.state !== 'VOID' && props.co.state !== 'APPROVED'}>
              <button
                type="button"
                disabled={busy()}
                onClick={() => transition('VOID')}
                class="ml-auto text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] underline"
              >
                Void
              </button>
            </Show>
          </div>
          <Show when={error()}>
            <div class="mt-2 text-xs text-[color:var(--color-danger)]">{error()}</div>
          </Show>
        </div>
      </Show>
    </li>
  );
}

const UNITS = ['each', 'hr', 'sqft', 'lf', 'cy', 'day', 'lump_sum'] as const;

function COLines(props: {
  co_id: string;
  editable: boolean;
  initialLines: COLine[];
  fallback_margin_pct: number;
  onMutated: () => void;
}) {
  const [rows, setRows] = createSignal<COLine[]>(props.initialLines);
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal({
    description: '',
    qty: 1,
    unit: 'each',
    unit_price: 0,
    margin_pct: null as number | null,
  });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const total = createMemo(() =>
    rows().reduce((s, r) => {
      const m = r.margin_pct != null ? r.margin_pct : props.fallback_margin_pct;
      return s + Number(r.subtotal) * (1 + m / 100);
    }, 0),
  );

  const patch = async (id: string, fields: Partial<COLine>) => {
    const before = rows();
    setRows(
      before.map((r) =>
        r.id === id
          ? {
              ...r,
              ...fields,
              subtotal:
                fields.qty != null || fields.unit_price != null
                  ? round2(Number(fields.qty ?? r.qty) * Number(fields.unit_price ?? r.unit_price))
                  : r.subtotal,
            }
          : r,
      ),
    );
    const resp = await fetch(`/api/change-order/${props.co_id}/line-item/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!resp.ok) {
      setError(await resp.text());
      setRows(before);
    } else {
      props.onMutated();
    }
  };

  const remove = async (id: string) => {
    const before = rows();
    setRows(before.filter((r) => r.id !== id));
    const resp = await fetch(`/api/change-order/${props.co_id}/line-item/${id}`, {
      method: 'DELETE',
    });
    if (!resp.ok) {
      setError(await resp.text());
      setRows(before);
    } else {
      props.onMutated();
    }
  };

  const submitNew = async () => {
    if (!draft().description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/change-order/${props.co_id}/line-item`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description: draft().description.trim(),
          qty: Number(draft().qty),
          unit: draft().unit,
          unit_price: Number(draft().unit_price),
          margin_pct: draft().margin_pct,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const created = (await resp.json()) as COLine;
      setRows([...rows(), created]);
      setDraft({ description: '', qty: 1, unit: 'each', unit_price: 0, margin_pct: null });
      setAdding(false);
      props.onMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Show
        when={rows().length > 0}
        fallback={
          <p class="text-[13px] italic font-serif text-[color:var(--color-muted)]">
            No lines yet on this change order.
          </p>
        }
      >
        <div class="overflow-x-auto">
          <table class="w-full min-w-[680px] text-sm">
            <thead>
              <tr class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
                <th class="px-2 py-1.5 text-left">Description</th>
                <th class="px-2 py-1.5 text-right">Qty</th>
                <th class="px-2 py-1.5 text-right">Unit</th>
                <th class="px-2 py-1.5 text-right">Cost</th>
                <th class="px-2 py-1.5 text-right">Margin</th>
                <th class="px-2 py-1.5 text-right">Total</th>
                <Show when={props.editable}>
                  <th class="w-6" />
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(li) => {
                  const effectiveMargin = () =>
                    li.margin_pct != null ? li.margin_pct : props.fallback_margin_pct;
                  const lineTotal = () => Number(li.subtotal) * (1 + effectiveMargin() / 100);
                  return (
                    <tr class="border-t border-[color:var(--color-line)] group">
                      <td class="px-2 py-2">
                        <Show
                          when={props.editable}
                          fallback={<span>{li.description}</span>}
                        >
                          <input
                            class="w-full bg-transparent outline-none focus:bg-[color:var(--color-surface-2)] rounded px-1 py-0.5"
                            value={li.description}
                            onBlur={(e) => {
                              const v = e.currentTarget.value.trim();
                              if (v && v !== li.description) patch(li.id, { description: v });
                            }}
                          />
                        </Show>
                      </td>
                      <td class="px-2 py-2 text-right font-mono tabular-nums">
                        {Number(li.qty).toLocaleString()}
                      </td>
                      <td class="px-2 py-2 text-right text-xs font-mono text-[color:var(--color-muted)]">
                        {li.unit ?? ''}
                      </td>
                      <td class="px-2 py-2 text-right font-mono tabular-nums">
                        {fmtCurrencyFull(Number(li.subtotal))}
                      </td>
                      <td class="px-2 py-2 text-right font-mono tabular-nums text-[color:var(--color-muted)]">
                        {effectiveMargin().toFixed(0)}%
                      </td>
                      <td class="px-2 py-2 text-right font-mono tabular-nums font-medium">
                        {fmtCurrencyFull(lineTotal())}
                      </td>
                      <Show when={props.editable}>
                        <td class="w-6">
                          <button
                            type="button"
                            onClick={() => remove(li.id)}
                            class="opacity-0 group-hover:opacity-100 text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] text-sm"
                          >
                            ×
                          </button>
                        </td>
                      </Show>
                    </tr>
                  );
                }}
              </For>
              <tr class="border-t border-[color:var(--color-ink)] bg-[color:var(--color-surface-2)]">
                <td colspan={5} class="px-2 py-2 text-right font-medium">CO total</td>
                <td class="px-2 py-2 text-right font-mono tabular-nums font-medium">
                  {fmtCurrencyFull(total())}
                </td>
                <Show when={props.editable}>
                  <td />
                </Show>
              </tr>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={props.editable}>
        <Show
          when={adding()}
          fallback={
            <button
              type="button"
              onClick={() => setAdding(true)}
              class="mt-2 text-xs text-[color:var(--color-accent)] hover:brightness-95 inline-flex items-center gap-1.5"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <path d="M5.5 2v7M2 5.5h7" />
              </svg>
              Add line
            </button>
          }
        >
          <div class="mt-3 rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface)] p-3 grid grid-cols-1 sm:grid-cols-[3fr_60px_70px_90px_70px_auto] gap-2 items-end">
            <Field label="Description">
              <Input
                value={draft().description}
                onInput={(e) => setDraft({ ...draft(), description: e.currentTarget.value })}
                placeholder="What's the work?"
              />
            </Field>
            <Field label="Qty">
              <Input
                type="number"
                step="0.001"
                value={draft().qty}
                onInput={(e) => setDraft({ ...draft(), qty: parseFloat(e.currentTarget.value) || 0 })}
              />
            </Field>
            <Field label="Unit">
              <select
                class="w-full px-3 py-2 rounded-lg text-sm bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)]"
                value={draft().unit}
                onChange={(e) => setDraft({ ...draft(), unit: e.currentTarget.value })}
              >
                <For each={UNITS}>{(u) => <option value={u}>{u}</option>}</For>
              </select>
            </Field>
            <Field label="Cost / unit">
              <Input
                type="number"
                step="0.01"
                value={draft().unit_price || ''}
                onInput={(e) => setDraft({ ...draft(), unit_price: parseFloat(e.currentTarget.value) || 0 })}
              />
            </Field>
            <Field label="Margin %">
              <Input
                type="number"
                step="0.5"
                placeholder={`${props.fallback_margin_pct}`}
                value={draft().margin_pct ?? ''}
                onInput={(e) => {
                  const raw = e.currentTarget.value;
                  setDraft({ ...draft(), margin_pct: raw === '' ? null : parseFloat(raw) });
                }}
              />
            </Field>
            <div class="flex gap-2">
              <Button variant="accent" disabled={busy() || !draft().description.trim()} onClick={submitNew}>
                {busy() ? '…' : 'Add'}
              </Button>
              <Button variant="ghost" onClick={() => { setAdding(false); setError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        </Show>
      </Show>

      <Show when={error()}>
        <div class="mt-2 text-xs text-[color:var(--color-danger)]">{error()}</div>
      </Show>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
