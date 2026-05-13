/**
 * <FreeformEditor> — generic section editor for the novel-path
 * wizard.
 *
 * Renders one block per Section based on its kind. Operator can edit
 * the content directly; sections come back pre-populated from the
 * proposer's prefill pass so the editor isn't empty.
 *
 * Stays deliberately bare — no add/remove section here (that lives
 * on the NovelShapeConfirmCard up top so shape changes happen in one
 * place). Editor is for content, card is for shape.
 */
import { For, Show } from 'solid-js';

import type { Section } from '@/lib/shape';

interface Props {
  sections: () => Section[];
  onUpdate: (idx: number, next: Section) => void;
}

export default function FreeformEditor(p: Props) {
  return (
    <div class="space-y-5">
      <For each={p.sections()}>
        {(section, idx) => (
          <SectionEditor
            section={section}
            position={idx() + 1}
            onUpdate={(next) => p.onUpdate(idx(), next)}
          />
        )}
      </For>
    </div>
  );
}

function SectionEditor(p: { section: Section; position: number; onUpdate: (next: Section) => void }) {
  return (
    <section class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
      <div class="px-4 py-3 border-b border-[color:var(--color-line)] flex items-baseline justify-between">
        <div class="flex items-baseline gap-2">
          <span class="text-[10px] font-mono text-[color:var(--color-muted-2)]">
            {String(p.position).padStart(2, '0')}
          </span>
          <h3 class="font-serif text-[16px] font-medium">{p.section.label}</h3>
        </div>
        <span class="text-[10px] font-mono uppercase text-[color:var(--color-muted-2)]">
          {p.section.kind === 'kv_table' ? 'Table' : p.section.kind}
        </span>
      </div>

      <Show when={p.section.kind === 'text'}>
        <textarea
          class="w-full min-h-[100px] resize-y px-4 py-3 text-[13.5px] leading-relaxed font-serif bg-transparent border-0 outline-none focus:bg-[color:var(--color-surface-2)]"
          placeholder="Write here…"
          value={(p.section as { body: string }).body}
          onInput={(e) =>
            p.onUpdate({ ...(p.section as { body: string } & Section), body: e.currentTarget.value } as Section)
          }
        />
      </Show>

      <Show when={p.section.kind === 'bullets'}>
        <BulletsEditor section={p.section as Extract<Section, { kind: 'bullets' }>} onUpdate={p.onUpdate} />
      </Show>

      <Show when={p.section.kind === 'kv_table'}>
        <KvTableEditor section={p.section as Extract<Section, { kind: 'kv_table' }>} onUpdate={p.onUpdate} />
      </Show>
    </section>
  );
}

function BulletsEditor(p: {
  section: Extract<Section, { kind: 'bullets' }>;
  onUpdate: (next: Section) => void;
}) {
  const text = () => p.section.items.join('\n');
  return (
    <textarea
      class="w-full min-h-[100px] resize-y px-4 py-3 text-[13px] leading-relaxed font-serif bg-transparent border-0 outline-none focus:bg-[color:var(--color-surface-2)]"
      placeholder={'One per line\n• Discovery workshop\n• Funnel audit'}
      value={text()}
      onInput={(e) => {
        const items = e.currentTarget.value
          .split('\n')
          .map((l) => l.replace(/^[\s•\-*]+/, '').trim())
          .filter((l) => l.length > 0);
        p.onUpdate({ ...p.section, items });
      }}
    />
  );
}

function KvTableEditor(p: {
  section: Extract<Section, { kind: 'kv_table' }>;
  onUpdate: (next: Section) => void;
}) {
  const colCount = () => p.section.headers.length;
  const gridCols = () =>
    colCount() === 3 ? 'grid-cols-[1fr_120px_1fr_28px]' : 'grid-cols-[1fr_140px_28px]';

  const updateCell = (rowIdx: number, header: string, value: string) => {
    const rows = p.section.rows.slice();
    rows[rowIdx] = { ...rows[rowIdx], [header]: value };
    p.onUpdate({ ...p.section, rows });
  };
  const addRow = () => {
    const empty: Record<string, string> = {};
    for (const h of p.section.headers) empty[h] = '';
    p.onUpdate({ ...p.section, rows: [...p.section.rows, empty] });
  };
  const removeRow = (idx: number) => {
    p.onUpdate({ ...p.section, rows: p.section.rows.filter((_, i) => i !== idx) });
  };

  return (
    <div>
      <div class={`grid ${gridCols()} gap-2 px-4 py-2 border-b border-[color:var(--color-line)] bg-[color:var(--color-paper-2,#f6f4ef)]`}>
        <For each={p.section.headers}>
          {(h) => (
            <div class="text-[11px] font-mono uppercase text-[color:var(--color-muted-2)] tracking-wide">
              {h}
            </div>
          )}
        </For>
        <div />
      </div>
      <Show
        when={p.section.rows.length > 0}
        fallback={
          <div class="px-4 py-5 text-[13px] text-[color:var(--color-muted)] italic font-serif">
            No rows yet. Add one below.
          </div>
        }
      >
        <ul class="divide-y divide-[color:var(--color-line)]">
          <For each={p.section.rows}>
            {(row, idx) => (
              <li class={`grid ${gridCols()} gap-2 items-center px-4 py-2 text-sm`}>
                <For each={p.section.headers}>
                  {(h) => (
                    <input
                      class="bg-transparent border-0 outline-none px-1 py-1 focus:bg-[color:var(--color-surface-2)] rounded"
                      value={row[h] ?? ''}
                      onInput={(e) => updateCell(idx(), h, e.currentTarget.value)}
                    />
                  )}
                </For>
                <button
                  type="button"
                  aria-label="Remove row"
                  onClick={() => removeRow(idx())}
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
          onClick={addRow}
          class="font-mono text-[11px] uppercase tracking-wide text-[color:var(--color-accent)] hover:text-[color:var(--color-ink)]"
        >
          + Add row
        </button>
      </div>
    </div>
  );
}
