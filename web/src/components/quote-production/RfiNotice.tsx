/**
 * RfiNotice — banner shown when scan classifies the uploaded
 * document as an INBOUND RFI. Brief's wizard assumes the operator is
 * authoring an outbound bid; an RFI is a buyer asking the operator
 * to respond.
 *
 * v1 surface: detect-and-warn. Operator sees what was detected, can
 * keep going in narrative mode (we still extract phases + scope, and
 * the editor lets them write a response) or back out. A dedicated
 * RFI-response flow is the Phase-2 follow-up if operator demand warrants.
 */
import { For, Show } from 'solid-js';

interface Props {
  confidence: () => number;
  requirements: () => string[];
  questions: () => string[];
  deadline?: () => string | null;
  onProceedAsNarrative?: () => void;
  onBack?: () => void;
}

export default function RfiNotice(p: Props) {
  return (
    <aside class="rounded-xl border border-[color:var(--color-warn,#a85432)] bg-[color:var(--color-warn-tint,#fcefe6)] p-5">
      <div class="flex items-baseline gap-2">
        <span class="text-eyebrow font-mono uppercase text-[color:var(--color-warn,#a85432)]">
          Heads up · RFI detected
        </span>
        <span class="text-[10.5px] font-mono text-[color:var(--color-muted-2)]">
          {Math.round(p.confidence() * 100)}% confidence
        </span>
      </div>
      <p class="mt-2 font-serif text-[15px] leading-snug text-[color:var(--color-ink)]">
        This looks like a buyer asking <em>you</em> to respond — not a
        bid you're authoring. Brief's wizard is built for outbound quotes.
      </p>
      <p class="mt-2 text-[13px] text-[color:var(--color-ink-2)] leading-relaxed">
        You can keep going and use Brief to draft the narrative response
        sections (scope, qualifications, approach), then submit through
        the buyer's format. A dedicated RFI-response flow is on the
        roadmap.
      </p>

      <Show when={p.requirements().length > 0}>
        <div class="mt-3 rounded-md bg-white/60 px-3 py-2.5">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-1.5">
            Requirements ({p.requirements().length})
          </div>
          <ul class="text-[12.5px] font-serif text-[color:var(--color-ink-2)] space-y-1 leading-snug">
            <For each={p.requirements().slice(0, 6)}>{(r) => <li>· {r}</li>}</For>
            <Show when={p.requirements().length > 6}>
              <li class="text-[color:var(--color-muted)] italic">
                + {p.requirements().length - 6} more
              </li>
            </Show>
          </ul>
        </div>
      </Show>

      <Show when={p.questions().length > 0}>
        <div class="mt-3 rounded-md bg-white/60 px-3 py-2.5">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)] mb-1.5">
            Vendor questions ({p.questions().length})
          </div>
          <ul class="text-[12.5px] font-serif text-[color:var(--color-ink-2)] space-y-1 leading-snug">
            <For each={p.questions().slice(0, 6)}>{(q) => <li>· {q}</li>}</For>
            <Show when={p.questions().length > 6}>
              <li class="text-[color:var(--color-muted)] italic">
                + {p.questions().length - 6} more
              </li>
            </Show>
          </ul>
        </div>
      </Show>

      <Show when={p.deadline?.() && p.deadline!()}>
        <div class="mt-3 text-[12px] font-mono text-[color:var(--color-ink-2)]">
          Submission deadline: <span class="text-[color:var(--color-ink)]">{p.deadline!()}</span>
        </div>
      </Show>

      <div class="mt-4 flex gap-2">
        <Show when={p.onProceedAsNarrative}>
          <button
            type="button"
            onClick={p.onProceedAsNarrative}
            class="font-mono text-[11.5px] uppercase tracking-wide border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-surface)] px-3 py-1.5 rounded-sm"
          >
            Continue as narrative response
          </button>
        </Show>
        <Show when={p.onBack}>
          <button
            type="button"
            onClick={p.onBack}
            class="font-mono text-[11.5px] uppercase tracking-wide border border-[color:var(--color-line)] bg-white px-3 py-1.5 rounded-sm"
          >
            ← Re-upload
          </button>
        </Show>
      </div>
    </aside>
  );
}
