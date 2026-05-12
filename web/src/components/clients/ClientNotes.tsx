/**
 * <ClientNotes> — editable notes textarea on the client detail page.
 *
 * Saves on blur to /api/client/[id] with { notes }. Plain debounced
 * persistence; no autosave-ticker. Reverts on server error.
 */
import { createSignal, Show } from 'solid-js';

interface Props {
  client_id: string;
  initial: string;
}

export default function ClientNotes(props: Props) {
  const [value, setValue] = createSignal(props.initial);
  const [committed, setCommitted] = createSignal(props.initial);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const save = async () => {
    if (value() === committed()) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/client/${props.client_id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ notes: value() }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setCommitted(value());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setValue(committed());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <textarea
        rows={5}
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onBlur={save}
        placeholder="What should you remember about this client? Pricing notes, quirks, who pays late, etc. Saved on blur."
        class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y leading-relaxed"
      />
      <div class="mt-1.5 flex items-center gap-2 text-[11px] font-mono">
        <Show
          when={!error()}
          fallback={<span class="text-[color:var(--color-danger)]">{error()}</span>}
        >
          <span class="text-[color:var(--color-muted)]">
            {busy() ? 'Saving…' : value() === committed() ? 'Saved' : 'Edited — blur to save'}
          </span>
        </Show>
      </div>
    </div>
  );
}
