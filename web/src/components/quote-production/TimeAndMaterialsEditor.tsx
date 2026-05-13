/**
 * TimeAndMaterialsEditor — rate cards + estimate band + reimbursables.
 *
 * Used for engagements where scope can't be fixed up front: discovery
 * work, ongoing support, anything billed by the hour. The actual
 * invoice is against logged hours; the wizard captures rate cards
 * (role → $/hr) and an estimate band (low–high hours) so the
 * proposal sets expectations on what the client should plan for.
 */
import { createMemo, For, Show } from 'solid-js';

export interface TmRate {
  role: string;
  rate: number;
}

export interface TmEstimate {
  hours_low: number;
  hours_high: number;
  materials: number;
}

interface Props {
  rates: () => TmRate[];
  setRates: (next: TmRate[]) => void;
  estimate: () => TmEstimate;
  setEstimate: (next: TmEstimate) => void;
}

export default function TimeAndMaterialsEditor(p: Props) {
  const update = (idx: number, patch: Partial<TmRate>) => {
    const next = p.rates().slice();
    next[idx] = { ...next[idx], ...patch };
    p.setRates(next);
  };
  const addRate = () => {
    p.setRates([...p.rates(), { role: '', rate: 0 }]);
  };
  const removeRate = (idx: number) => {
    p.setRates(p.rates().filter((_, i) => i !== idx));
  };

  // Rough estimate band — average rate × hours range + materials.
  const avgRate = createMemo(() => {
    const rates = p.rates().filter((r) => r.rate > 0);
    if (rates.length === 0) return 0;
    return rates.reduce((s, r) => s + r.rate, 0) / rates.length;
  });
  const estimateLow = createMemo(() =>
    Math.round(avgRate() * p.estimate().hours_low + p.estimate().materials),
  );
  const estimateHigh = createMemo(() =>
    Math.round(avgRate() * p.estimate().hours_high + p.estimate().materials),
  );

  return (
    <div class="space-y-4">
      {/* Rate cards */}
      <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
        <div class="grid grid-cols-[40px_1fr_140px_36px] gap-3 px-4 py-3 border-b border-[color:var(--color-line)] text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
          <div>#</div>
          <div>Role</div>
          <div class="text-right">Rate / hr</div>
          <div />
        </div>

        <Show
          when={p.rates().length > 0}
          fallback={
            <div class="px-4 py-5 text-[13px] text-[color:var(--color-muted)] italic font-serif">
              No rates yet. Add one for each role the engagement bills.
            </div>
          }
        >
          <ul class="divide-y divide-[color:var(--color-line)]">
            <For each={p.rates()}>
              {(r, idx) => (
                <li class="grid grid-cols-[40px_1fr_140px_36px] gap-3 items-center px-4 py-2.5 text-sm">
                  <div class="font-mono text-[11px] text-[color:var(--color-muted-2)]">
                    {String(idx() + 1).padStart(2, '0')}
                  </div>
                  <input
                    class="bg-transparent border-0 outline-none px-1 py-1 focus:bg-[color:var(--color-surface-2)] rounded"
                    value={r.role}
                    placeholder="e.g. Principal, Analyst"
                    onInput={(e) => update(idx(), { role: e.currentTarget.value })}
                  />
                  <input
                    type="number"
                    step="10"
                    class="bg-transparent border-0 outline-none px-1 py-1 text-right tabular-nums focus:bg-[color:var(--color-surface-2)] rounded"
                    value={r.rate || ''}
                    placeholder="0"
                    onInput={(e) => update(idx(), { rate: parseFloat(e.currentTarget.value || '0') })}
                  />
                  <button
                    type="button"
                    aria-label="Remove rate"
                    onClick={() => removeRate(idx())}
                    class="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] text-lg leading-none"
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <div class="px-4 py-2 border-t border-[color:var(--color-line)]">
          <button
            type="button"
            onClick={addRate}
            class="font-mono text-[11px] uppercase tracking-wide text-[color:var(--color-accent)] hover:text-[color:var(--color-ink)]"
          >
            + Add role
          </button>
        </div>
      </div>

      {/* Estimate band */}
      <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Estimated hours · low
          </div>
          <input
            type="number"
            step="10"
            class="mt-1 w-full bg-transparent border-0 outline-none font-serif text-[24px] tabular-nums focus:bg-[color:var(--color-surface-2)] rounded px-1"
            value={p.estimate().hours_low || ''}
            placeholder="0"
            onInput={(e) =>
              p.setEstimate({
                ...p.estimate(),
                hours_low: parseFloat(e.currentTarget.value || '0'),
              })
            }
          />
        </div>
        <div>
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Estimated hours · high
          </div>
          <input
            type="number"
            step="10"
            class="mt-1 w-full bg-transparent border-0 outline-none font-serif text-[24px] tabular-nums focus:bg-[color:var(--color-surface-2)] rounded px-1"
            value={p.estimate().hours_high || ''}
            placeholder="0"
            onInput={(e) =>
              p.setEstimate({
                ...p.estimate(),
                hours_high: parseFloat(e.currentTarget.value || '0'),
              })
            }
          />
        </div>
        <div>
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Materials / reimbursables
          </div>
          <input
            type="number"
            step="100"
            class="mt-1 w-full bg-transparent border-0 outline-none font-serif text-[24px] tabular-nums focus:bg-[color:var(--color-surface-2)] rounded px-1"
            value={p.estimate().materials || ''}
            placeholder="0"
            onInput={(e) =>
              p.setEstimate({
                ...p.estimate(),
                materials: parseFloat(e.currentTarget.value || '0'),
              })
            }
          />
        </div>
      </div>

      {/* Estimate readout */}
      <Show when={avgRate() > 0 && p.estimate().hours_high > 0}>
        <div class="rounded-xl bg-[color:var(--color-paper-2,#f6f4ef)] px-5 py-4">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Estimate band
          </div>
          <div class="mt-1 font-serif text-[24px] tabular-nums">
            ${estimateLow().toLocaleString()} – ${estimateHigh().toLocaleString()}
          </div>
          <p class="mt-1.5 text-[12.5px] font-serif italic text-[color:var(--color-muted)] leading-relaxed">
            T&amp;M billing — actuals invoiced against logged hours.
            Estimate above is planning only.
          </p>
        </div>
      </Show>
    </div>
  );
}
