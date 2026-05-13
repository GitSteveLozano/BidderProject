/**
 * RfiResponseEditor — dedicated editor when proposal_style is
 * 'rfi_received'. Brief's normal wizard outputs a quote-style PDF;
 * an RFI response is the inverse — the operator is answering the
 * buyer's structured request, not authoring an outbound bid.
 *
 * Surfaces three editable sections:
 *
 *   1. Requirements — each requirement gets a textarea response.
 *      Operator drafts in their own words; Composition can suggest
 *      voice-matched language via the per-row "Draft" button.
 *
 *   2. Vendor questions — each question gets an answer field.
 *
 *   3. Narrative response sections — free-form headings + bodies
 *      (cover letter, approach, qualifications, team). Add / remove
 *      as the buyer's submission format requires.
 *
 * Total $ is irrelevant for v1 RFI responses — the buyer asks for
 * pricing in their own format inside one of the sections. ReviewStep
 * still shows the response as the deliverable + lets the operator
 * export to PDF or copy section-by-section.
 */
import { createSignal, For, Show } from 'solid-js';

export interface RfiResponseShape {
  requirements_answered: Array<{ requirement: string; response: string }>;
  questions_answered: Array<{ question: string; answer: string }>;
  narrative_sections: Array<{ heading: string; body: string }>;
  cover_letter: string;
  submission_format: string;
}

interface Props {
  /** Source requirements from scan — read-only buyer text. */
  requirements: () => string[];
  /** Source questions from scan — read-only buyer text. */
  questions: () => string[];
  /** Current edited response. */
  response: () => RfiResponseShape;
  setResponse: (next: RfiResponseShape) => void;
  /** Asks Composition for a voice-matched draft of one section. */
  draftSection?: (heading: string, prompt: string) => Promise<string>;
}

export default function RfiResponseEditor(p: Props) {
  const [drafting, setDrafting] = createSignal<string | null>(null);

  const updateRequirementResponse = (idx: number, response: string) => {
    const r = { ...p.response() };
    const list = r.requirements_answered.slice();
    list[idx] = { ...list[idx], response };
    r.requirements_answered = list;
    p.setResponse(r);
  };
  const updateQuestionAnswer = (idx: number, answer: string) => {
    const r = { ...p.response() };
    const list = r.questions_answered.slice();
    list[idx] = { ...list[idx], answer };
    r.questions_answered = list;
    p.setResponse(r);
  };
  const updateSection = (idx: number, patch: { heading?: string; body?: string }) => {
    const r = { ...p.response() };
    const list = r.narrative_sections.slice();
    list[idx] = { ...list[idx], ...patch };
    r.narrative_sections = list;
    p.setResponse(r);
  };
  const addSection = () => {
    const r = { ...p.response() };
    r.narrative_sections = [...r.narrative_sections, { heading: '', body: '' }];
    p.setResponse(r);
  };
  const removeSection = (idx: number) => {
    const r = { ...p.response() };
    r.narrative_sections = r.narrative_sections.filter((_, i) => i !== idx);
    p.setResponse(r);
  };

  const draftFor = async (idx: number) => {
    if (!p.draftSection) return;
    const section = p.response().narrative_sections[idx];
    if (!section) return;
    setDrafting(`section-${idx}`);
    try {
      const text = await p.draftSection(section.heading, section.body);
      updateSection(idx, { body: text });
    } finally {
      setDrafting(null);
    }
  };

  return (
    <div class="space-y-6">
      <header class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-paper-2,#f6f4ef)] px-5 py-4">
        <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
          RFI response editor
        </div>
        <h2 class="mt-1 font-serif text-[22px] font-medium leading-snug">
          You're responding to a buyer, not authoring an outbound bid.
        </h2>
        <p class="mt-1.5 text-[13px] text-[color:var(--color-ink-2)] leading-relaxed">
          Draft answers to each requirement and question. Add narrative
          sections (cover letter, approach, qualifications) as the buyer's
          format requires. ReviewStep renders the full response document.
        </p>
      </header>

      {/* Cover letter */}
      <section class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
        <div class="px-4 py-3 border-b border-[color:var(--color-line)]">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
            Cover letter
          </div>
        </div>
        <textarea
          class="w-full text-[14px] leading-relaxed font-serif bg-transparent border-0 outline-none px-4 py-3 focus:bg-[color:var(--color-surface-2)] resize-y min-h-[120px]"
          placeholder="Open with intent, summary of capability, and a clear close. Brief drafts this in your voice via the Composition agent."
          value={p.response().cover_letter}
          onInput={(e) =>
            p.setResponse({ ...p.response(), cover_letter: e.currentTarget.value })
          }
        />
      </section>

      {/* Requirements answered */}
      <Show when={p.response().requirements_answered.length > 0}>
        <section class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
          <div class="px-4 py-3 border-b border-[color:var(--color-line)] flex justify-between items-baseline">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
              Requirements
            </div>
            <span class="text-[11px] font-mono text-[color:var(--color-muted-2)]">
              {p.response().requirements_answered.filter((r) => r.response.trim()).length} /{' '}
              {p.response().requirements_answered.length} answered
            </span>
          </div>
          <ul class="divide-y divide-[color:var(--color-line)]">
            <For each={p.response().requirements_answered}>
              {(item, idx) => (
                <li class="px-4 py-3.5">
                  <div class="text-[13px] text-[color:var(--color-ink)] font-serif leading-snug">
                    <span class="font-mono text-[10px] text-[color:var(--color-muted-2)] mr-1.5">
                      R{String(idx() + 1).padStart(2, '0')}
                    </span>
                    {item.requirement}
                  </div>
                  <textarea
                    class="mt-2 w-full text-[13px] leading-relaxed bg-[color:var(--color-paper-2,#f6f4ef)] border border-[color:var(--color-line)] rounded-md p-3 font-serif resize-y min-h-[80px]"
                    placeholder="Your response…"
                    value={item.response}
                    onInput={(e) => updateRequirementResponse(idx(), e.currentTarget.value)}
                  />
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      {/* Vendor questions answered */}
      <Show when={p.response().questions_answered.length > 0}>
        <section class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
          <div class="px-4 py-3 border-b border-[color:var(--color-line)] flex justify-between items-baseline">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
              Vendor questions
            </div>
            <span class="text-[11px] font-mono text-[color:var(--color-muted-2)]">
              {p.response().questions_answered.filter((q) => q.answer.trim()).length} /{' '}
              {p.response().questions_answered.length} answered
            </span>
          </div>
          <ul class="divide-y divide-[color:var(--color-line)]">
            <For each={p.response().questions_answered}>
              {(item, idx) => (
                <li class="px-4 py-3.5">
                  <div class="text-[13px] text-[color:var(--color-ink)] font-serif leading-snug">
                    <span class="font-mono text-[10px] text-[color:var(--color-muted-2)] mr-1.5">
                      Q{String(idx() + 1).padStart(2, '0')}
                    </span>
                    {item.question}
                  </div>
                  <textarea
                    class="mt-2 w-full text-[13px] leading-relaxed bg-[color:var(--color-paper-2,#f6f4ef)] border border-[color:var(--color-line)] rounded-md p-3 font-serif resize-y min-h-[60px]"
                    placeholder="Your answer…"
                    value={item.answer}
                    onInput={(e) => updateQuestionAnswer(idx(), e.currentTarget.value)}
                  />
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      {/* Narrative sections */}
      <section class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
        <div class="px-4 py-3 border-b border-[color:var(--color-line)] flex justify-between items-baseline">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
            Narrative sections
          </div>
          <span class="text-[11px] font-mono text-[color:var(--color-muted-2)]">
            {p.response().narrative_sections.length} section
            {p.response().narrative_sections.length === 1 ? '' : 's'}
          </span>
        </div>
        <Show
          when={p.response().narrative_sections.length > 0}
          fallback={
            <div class="px-4 py-5 text-[13px] text-[color:var(--color-muted)] italic font-serif">
              No sections yet. Add cover letter follow-ons, approach, qualifications,
              or whatever the buyer's submission format expects.
            </div>
          }
        >
          <ul class="divide-y divide-[color:var(--color-line)]">
            <For each={p.response().narrative_sections}>
              {(section, idx) => (
                <li class="px-4 py-3.5">
                  <div class="flex items-center gap-2">
                    <input
                      class="flex-1 bg-transparent border-0 outline-none font-serif text-[15px] font-medium focus:bg-[color:var(--color-surface-2)] rounded px-1"
                      placeholder="Section heading (e.g. Approach, Qualifications)"
                      value={section.heading}
                      onInput={(e) => updateSection(idx(), { heading: e.currentTarget.value })}
                    />
                    <Show when={p.draftSection}>
                      <button
                        type="button"
                        onClick={() => draftFor(idx())}
                        disabled={drafting() === `section-${idx()}` || !section.heading.trim()}
                        class="font-mono text-[11px] uppercase tracking-wide border border-[color:var(--color-line)] hover:border-[color:var(--color-ink)] disabled:opacity-50 bg-white px-2.5 py-1 rounded-sm"
                      >
                        {drafting() === `section-${idx()}` ? '…' : 'Draft'}
                      </button>
                    </Show>
                    <button
                      type="button"
                      aria-label="Remove section"
                      onClick={() => removeSection(idx())}
                      class="text-[color:var(--color-muted)] hover:text-[color:var(--color-danger)] text-lg leading-none"
                    >
                      ×
                    </button>
                  </div>
                  <textarea
                    class="mt-2 w-full text-[13px] leading-relaxed bg-[color:var(--color-paper-2,#f6f4ef)] border border-[color:var(--color-line)] rounded-md p-3 font-serif resize-y min-h-[100px]"
                    placeholder="Body text…"
                    value={section.body}
                    onInput={(e) => updateSection(idx(), { body: e.currentTarget.value })}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="px-4 py-3 border-t border-[color:var(--color-line)]">
          <button
            type="button"
            onClick={addSection}
            class="font-mono text-[11.5px] uppercase tracking-wide text-[color:var(--color-accent)] hover:text-[color:var(--color-ink)]"
          >
            + Add section
          </button>
        </div>
      </section>

      {/* Submission format */}
      <section class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] overflow-hidden">
        <div class="px-4 py-3 border-b border-[color:var(--color-line)]">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
            Submission notes
          </div>
        </div>
        <textarea
          class="w-full text-[13px] leading-relaxed font-serif bg-transparent border-0 outline-none px-4 py-3 focus:bg-[color:var(--color-surface-2)] resize-y min-h-[60px]"
          placeholder="How the buyer wants this submitted (portal URL, email address, format, deadline)…"
          value={p.response().submission_format}
          onInput={(e) =>
            p.setResponse({ ...p.response(), submission_format: e.currentTarget.value })
          }
        />
      </section>
    </div>
  );
}
