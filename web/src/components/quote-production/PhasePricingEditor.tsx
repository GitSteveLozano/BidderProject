/**
 * PhasePricingEditor — phase-with-fee editor for the Pricing step
 * when proposal_style is consulting or partnership and phases exist.
 *
 * Replaces (not augments) the line-items table for narrative proposals
 * that price by phase, not by qty × unit price. Operator sees:
 *
 *   01  Discovery & alignment      4 wks    $18,000
 *   02  Buyer funnel design        6 wks    $32,000
 *   03  Production + handoff       4 wks    $24,000
 *                                  Total:   $74,000
 *
 * Total = sum of phase fees. No margin slider — these are
 * fixed-price phases; margin is implicit in the operator's fee.
 */
import { For, Show } from 'solid-js';

import type { Phase } from './PhasesEditor';

interface Props {
  phases: () => Phase[];
  onUpdate: (idx: number, patch: Partial<Phase>) => void;
  total: () => number;
}

export default function PhasePricingEditor(p: Props) {
  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
      <div class="grid grid-cols-[40px_1fr_120px_140px] gap-3 px-4 py-3 border-b border-[color:var(--color-line)] text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
        <div>#</div>
        <div>Phase</div>
        <div class="text-right">Duration</div>
        <div class="text-right">Fee</div>
      </div>

      <Show
        when={p.phases().length > 0}
        fallback={
          <div class="px-4 py-6 text-[13px] text-[color:var(--color-muted)] italic font-serif">
            No phases yet. Add them on the Scope step.
          </div>
        }
      >
        <ul class="divide-y divide-[color:var(--color-line)]">
          <For each={p.phases()}>
            {(phase, idx) => (
              <li class="grid grid-cols-[40px_1fr_120px_140px] gap-3 items-center px-4 py-2.5 text-sm">
                <div class="font-mono text-[11px] text-[color:var(--color-muted-2)]">
                  {String(idx() + 1).padStart(2, '0')}
                </div>
                <input
                  class="bg-transparent border-0 outline-none px-1 py-1 focus:bg-[color:var(--color-surface-2)] rounded font-serif"
                  value={phase.name}
                  onInput={(e) => p.onUpdate(idx(), { name: e.currentTarget.value })}
                />
                <input
                  class="bg-transparent border-0 outline-none px-1 py-1 text-right text-xs text-[color:var(--color-muted)] focus:bg-[color:var(--color-surface-2)] rounded font-mono"
                  value={phase.duration ?? ''}
                  placeholder="e.g. 4 wks"
                  onInput={(e) =>
                    p.onUpdate(idx(), { duration: e.currentTarget.value || null })
                  }
                />
                <input
                  type="number"
                  step="100"
                  class="bg-transparent border-0 outline-none px-1 py-1 text-right tabular-nums focus:bg-[color:var(--color-surface-2)] rounded"
                  value={phase.fee ?? ''}
                  placeholder="0"
                  onInput={(e) => {
                    const raw = e.currentTarget.value;
                    p.onUpdate(idx(), { fee: raw === '' ? null : parseFloat(raw) });
                  }}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="grid grid-cols-[40px_1fr_120px_140px] gap-3 px-4 py-3 border-t border-[color:var(--color-line)] items-baseline">
        <div />
        <div />
        <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] text-right">
          Total
        </div>
        <div class="text-right font-mono font-serif text-[18px] tabular-nums font-medium">
          ${p.total().toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
      </div>
    </div>
  );
}
