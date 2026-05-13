/**
 * Cover note panel — sits in the Review step's sidebar.
 *
 * Operator clicks "Draft a cover note" and the Composition agent
 * produces a voice-matched email opener. Operator can copy/edit
 * before send. Pre-save: no quote_id needed — Composition runs
 * against Context + the in-flight quote fields directly.
 */
import { createSignal, Show } from 'solid-js';

interface Props {
  scopeSummary: () => string;
  clientName: () => string;
  contactName: () => string;
  projectTitle: () => string;
  total: () => number;
}

export default function CoverNotePanel(p: Props) {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [text, setText] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch('/api/composition/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'cover_note',
          scope_summary: p.scopeSummary(),
          client_name: p.clientName(),
          contact_name: p.contactName(),
          project_title: p.projectTitle(),
          total: p.total(),
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || `${r.status}`);
      }
      const json = (await r.json()) as { text?: string };
      setText(json.text ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    const t = text();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — fall back to manual select
    }
  };

  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
        Cover note
      </div>
      <Show
        when={text()}
        fallback={
          <>
            <p class="mt-1.5 text-[12.5px] text-[color:var(--color-muted)] leading-relaxed">
              Brief drafts the email opener in your voice using your past quotes + voice profile.
            </p>
            <button
              type="button"
              disabled={loading()}
              onClick={generate}
              class="mt-3 w-full font-mono text-[12px] uppercase tracking-wide border border-[color:var(--color-line)] hover:border-[color:var(--color-ink)] disabled:opacity-50 bg-white px-3 py-2 rounded-sm"
            >
              {loading() ? 'Drafting…' : 'Draft cover note'}
            </button>
            <Show when={error()}>
              <p class="mt-2 text-[12px] text-[color:var(--color-danger,#a85432)]">{error()}</p>
            </Show>
          </>
        }
      >
        {(t) => (
          <>
            <textarea
              class="mt-2 w-full text-[13px] leading-relaxed bg-[color:var(--color-paper-2,#f6f4ef)] border border-[color:var(--color-line)] rounded-md p-3 font-serif resize-y min-h-[140px]"
              value={t()}
              onInput={(e) => setText(e.currentTarget.value)}
            />
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                onClick={copy}
                class="flex-1 font-mono text-[11px] uppercase tracking-wide border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-surface)] px-3 py-1.5 rounded-sm"
              >
                {copied() ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={generate}
                disabled={loading()}
                class="font-mono text-[11px] uppercase tracking-wide border border-[color:var(--color-line)] bg-white px-3 py-1.5 rounded-sm"
              >
                {loading() ? '…' : 'Redraft'}
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
