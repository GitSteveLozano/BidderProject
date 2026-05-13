/**
 * <NovelShapeConfirmCard> — the one-click confirmation that keeps
 * the novel-path fast.
 *
 * When the scan returns a doc that doesn't match a known fast-path
 * shape, the wizard calls /api/shape/propose and feeds the result
 * here. The card shows:
 *   - The proposed shape name
 *   - The section pills (e.g. Cover · Rebate program · Transition plan)
 *   - One primary button "Looks right" → confirms + drops into the
 *     pre-populated FreeformEditor below
 *   - One secondary button "Edit shape" → opens an inline editor
 *     to rename / add / remove sections
 *
 * 95% of novel docs should be a single Accept click. The editor is
 * the escape hatch.
 */
import { createSignal, For, Show } from 'solid-js';

import type { Section, Shape } from '@/lib/shape';

interface Props {
  shape: () => Shape;
  source: () => 'matched' | 'proposed';
  matchDistance: () => number | null;
  /** Operator updates the shape — caller mirrors into wizard state. */
  onUpdateShape: (next: Shape) => void;
  onAccept: () => void;
}

const KIND_LABEL: Record<Section['kind'], string> = {
  text: 'Text',
  bullets: 'List',
  kv_table: 'Table',
};

export default function NovelShapeConfirmCard(p: Props) {
  const [editing, setEditing] = createSignal(false);
  const [newKind, setNewKind] = createSignal<Section['kind']>('text');
  const [newLabel, setNewLabel] = createSignal('');

  const rename = (idx: number, label: string) => {
    const next = { ...p.shape() };
    next.sections = next.sections.slice();
    next.sections[idx] = { ...next.sections[idx], label };
    p.onUpdateShape(next);
  };
  const remove = (idx: number) => {
    const next = { ...p.shape() };
    next.sections = next.sections.filter((_, i) => i !== idx);
    p.onUpdateShape(next);
  };
  const addSection = () => {
    const label = newLabel().trim();
    if (!label) return;
    const next = { ...p.shape() };
    const key = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const kind = newKind();
    const section: Section =
      kind === 'text'
        ? { kind: 'text', key, label, body: '' }
        : kind === 'bullets'
          ? { kind: 'bullets', key, label, items: [] }
          : { kind: 'kv_table', key, label, headers: ['Column A', 'Column B'], rows: [] };
    next.sections = [...next.sections, section];
    p.onUpdateShape(next);
    setNewLabel('');
  };

  return (
    <section class="rounded-xl border border-[color:var(--color-accent,#a85432)] bg-[color:var(--color-accent-tint,#fbe9d4)] p-5">
      <div class="flex items-baseline justify-between gap-3">
        <div>
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-accent,#a85432)]">
            {p.source() === 'matched' ? 'Matched layout' : 'Brief proposes a layout'}
          </div>
          <h3 class="mt-1 font-serif text-[20px] font-medium leading-snug">
            {p.shape().name}
          </h3>
          <Show when={p.shape().description}>
            <p class="text-[12.5px] text-[color:var(--color-ink-2)] mt-1">
              {p.shape().description}
            </p>
          </Show>
        </div>
        <Show when={p.matchDistance() != null}>
          <span class="text-[10.5px] font-mono text-[color:var(--color-muted-2)] shrink-0">
            match {(1 - (p.matchDistance() ?? 0)).toFixed(2)}
          </span>
        </Show>
      </div>

      <Show
        when={editing()}
        fallback={
          <div class="mt-3 flex flex-wrap gap-1.5">
            <For each={p.shape().sections}>
              {(s) => (
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/70 text-[12px] font-medium">
                  <span class="text-[10px] font-mono text-[color:var(--color-muted-2)] uppercase">
                    {KIND_LABEL[s.kind]}
                  </span>
                  <span>{s.label}</span>
                </span>
              )}
            </For>
          </div>
        }
      >
        <ul class="mt-3 space-y-1.5">
          <For each={p.shape().sections}>
            {(s, idx) => (
              <li class="flex items-center gap-2 bg-white/70 rounded-md px-3 py-1.5 text-[13px]">
                <span class="text-[10px] font-mono text-[color:var(--color-muted-2)] uppercase w-12 shrink-0">
                  {KIND_LABEL[s.kind]}
                </span>
                <input
                  class="flex-1 bg-transparent border-0 outline-none focus:bg-[color:var(--color-paper-2,#f6f4ef)] rounded px-1"
                  value={s.label}
                  onInput={(e) => rename(idx(), e.currentTarget.value)}
                />
                <button
                  type="button"
                  aria-label="Remove section"
                  onClick={() => remove(idx())}
                  class="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] text-lg leading-none"
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
        <div class="mt-2 flex gap-1.5">
          <select
            value={newKind()}
            onChange={(e) => setNewKind(e.currentTarget.value as Section['kind'])}
            class="text-[12px] font-mono px-2 py-1.5 rounded bg-white border border-[color:var(--color-line-2)]"
          >
            <option value="text">Text</option>
            <option value="bullets">List</option>
            <option value="kv_table">Table</option>
          </select>
          <input
            class="flex-1 text-[12.5px] px-2 py-1.5 rounded bg-white border border-[color:var(--color-line-2)]"
            value={newLabel()}
            onInput={(e) => setNewLabel(e.currentTarget.value)}
            placeholder="New section name (e.g. Qualifications)"
            onKeyDown={(e) => e.key === 'Enter' && addSection()}
          />
          <button
            type="button"
            onClick={addSection}
            disabled={!newLabel().trim()}
            class="font-mono text-[11px] uppercase tracking-wide border border-[color:var(--color-line-2)] bg-white px-3 py-1.5 rounded-sm disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </Show>

      <div class="mt-4 flex gap-2">
        <button
          type="button"
          onClick={p.onAccept}
          class="font-mono text-[12px] uppercase tracking-wide border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-surface)] px-4 py-2 rounded-sm"
        >
          Looks right — continue
        </button>
        <button
          type="button"
          onClick={() => setEditing((s) => !s)}
          class="font-mono text-[12px] uppercase tracking-wide border border-[color:var(--color-line-2)] bg-white px-3 py-2 rounded-sm"
        >
          {editing() ? 'Done editing' : 'Edit shape'}
        </button>
      </div>
    </section>
  );
}
