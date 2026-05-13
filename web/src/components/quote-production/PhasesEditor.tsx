/**
 * PhasesEditor — editable phases list for consulting + partnership
 * proposals. Used in ScopeStep when proposal_style is not
 * project_quote. Operator can rename phases, edit deliverables,
 * adjust duration, add/remove phases.
 *
 * Mirrors the line items editor's aesthetic but works in the
 * phase/deliverable shape that consulting decks use (Paras GTM,
 * Hardie partnership transitions, etc.). No qty/unit/price columns —
 * the structure is narrative, not itemized.
 */
import { For, Show } from 'solid-js';

export interface Phase {
  name: string;
  deliverables: string[];
  duration?: string | null;
}

interface Props {
  phases: () => Phase[];
  onUpdate: (idx: number, patch: Partial<Phase>) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}

export default function PhasesEditor(p: Props) {
  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
      <div class="px-4 py-3 border-b border-[color:var(--color-line)] flex justify-between items-baseline">
        <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
          Phases & deliverables
        </div>
        <span class="text-[11px] font-mono text-[color:var(--color-muted-2)]">
          {p.phases().length} phase{p.phases().length === 1 ? '' : 's'}
        </span>
      </div>

      <Show
        when={p.phases().length > 0}
        fallback={
          <div class="px-4 py-6 text-[13px] text-[color:var(--color-muted)] italic font-serif">
            No phases yet. Add one to structure a consulting or partnership
            proposal as phase + deliverables.
          </div>
        }
      >
        <ul class="divide-y divide-[color:var(--color-line)]">
          <For each={p.phases()}>
            {(phase, idx) => (
              <li class="px-4 py-3.5">
                <div class="flex items-start gap-3">
                  <div class="font-mono text-[11px] text-[color:var(--color-muted-2)] mt-1.5 w-8 shrink-0">
                    {String(idx() + 1).padStart(2, '0')}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex gap-2 items-center">
                      <input
                        class="flex-1 bg-transparent border-0 outline-none font-serif text-[15px] font-medium focus:bg-[color:var(--color-surface-2)] rounded px-1"
                        value={phase.name}
                        placeholder="Phase name"
                        onInput={(e) =>
                          p.onUpdate(idx(), { name: e.currentTarget.value })
                        }
                      />
                      <input
                        class="w-32 bg-transparent border-0 outline-none text-[12px] text-[color:var(--color-muted)] focus:bg-[color:var(--color-surface-2)] rounded px-1 text-right font-mono"
                        value={phase.duration ?? ''}
                        placeholder="Duration"
                        onInput={(e) =>
                          p.onUpdate(idx(), {
                            duration: e.currentTarget.value || null,
                          })
                        }
                      />
                    </div>
                    <div class="mt-2">
                      <textarea
                        class="w-full bg-transparent border-0 outline-none text-[13px] leading-relaxed focus:bg-[color:var(--color-surface-2)] rounded px-1 py-1 font-serif resize-y min-h-[60px]"
                        placeholder={'One deliverable per line\n• Discovery workshop\n• Funnel audit'}
                        value={phase.deliverables.join('\n')}
                        onInput={(e) => {
                          const lines = e.currentTarget.value
                            .split('\n')
                            .map((l) => l.replace(/^[\s•\-*]+/, '').trim())
                            .filter((l) => l.length > 0);
                          p.onUpdate(idx(), { deliverables: lines });
                        }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove phase"
                    onClick={() => p.onRemove(idx())}
                    class="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="px-4 py-3 border-t border-[color:var(--color-line)]">
        <button
          type="button"
          onClick={p.onAdd}
          class="font-mono text-[11.5px] uppercase tracking-wide text-[color:var(--color-accent)] hover:text-[color:var(--color-ink)]"
        >
          + Add phase
        </button>
      </div>
    </div>
  );
}
