/**
 * <BuildQuoteButton> — synthesizes a draft quote from the project's
 * attached documents + cost basis, then navigates to the editor.
 *
 * Calls POST /api/project/[id]/build-quote. On success, redirects to
 * `/quotes/[new_id]`. On error, surfaces the message inline.
 */
import { createSignal } from 'solid-js';

export default function BuildQuoteButton(props: {
  projectId: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const onClick = async () => {
    if (busy()) return;
    setBusy(true);
    setErr(null);
    try {
      const resp = await fetch(`/api/project/${props.projectId}/build-quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const data = (await resp.json()) as {
        error?: string;
        quote_id?: string;
        next_url?: string;
      };
      if (!resp.ok) {
        setErr(data.error ?? `Request failed (${resp.status})`);
        setBusy(false);
        return;
      }
      window.location.href = data.next_url ?? `/quotes/${data.quote_id}`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy() || props.disabled}
        title={props.disabled ? props.disabledReason : undefined}
        class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] font-medium text-[13px] hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy() ? 'Drafting…' : 'Build a quote from this project'}
      </button>
      {err() && (
        <div class="mt-2 text-[12px] text-[color:var(--color-danger)]">{err()}</div>
      )}
      {props.disabled && !busy() && props.disabledReason && (
        <div class="mt-2 text-[11.5px] font-mono text-[color:var(--color-muted)] text-center">
          {props.disabledReason}
        </div>
      )}
    </div>
  );
}
