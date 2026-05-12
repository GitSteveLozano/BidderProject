/**
 * <LogReplyButton> — small "Log a reply" action on the quote detail.
 *
 * Opens a slide-over with a paste-the-email form. Submits to
 * /api/inbound/email which records the inbound message, flips the
 * quote to RESPONDED, and emits the activity event. Used by operators
 * who receive client replies in their personal Gmail (because the
 * outbound Brevo email uses Reply-To: shop.owner_email).
 */
import { createSignal, Show } from 'solid-js';
import SlideOver from '@/components/ui/SlideOver';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';

interface Props {
  quote_id: string;
  default_from?: string;
  default_subject?: string;
}

export default function LogReplyButton(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [from, setFrom] = createSignal(props.default_from ?? '');
  const [subject, setSubject] = createSignal(props.default_subject ?? '');
  const [body, setBody] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async () => {
    if (!body().trim()) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/inbound/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quote_id: props.quote_id,
          from: from().trim() || null,
          subject: subject().trim() || null,
          body: body().trim(),
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      // Page reload picks up the new state + message in the SSR view.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface)] text-[13px] font-medium hover:bg-[color:var(--color-surface-2)]"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
          <rect x="1.5" y="2.5" width="9" height="7" rx="1" />
          <path d="M1.5 3.5l4.5 3 4.5-3" />
        </svg>
        Log a reply
      </button>

      <SlideOver
        open={open()}
        onClose={() => setOpen(false)}
        eyebrow="Inbound message"
        title="Log a reply you received"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <div class="flex-1" />
            <Button variant="accent" disabled={busy() || !body().trim()} onClick={submit}>
              {busy() ? 'Logging…' : 'Log reply'}
            </Button>
          </>
        }
      >
        <p class="text-sm font-serif italic text-[color:var(--color-muted)] mb-4 leading-relaxed">
          Replies land in your Gmail because we set Reply-To to your shop's email.
          Paste what they wrote and Brief threads it back into this quote.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <Field label="From (email)">
            <Input
              type="email"
              value={from()}
              onInput={(e) => setFrom(e.currentTarget.value)}
              placeholder="client@example.com"
            />
          </Field>
          <Field label="Subject">
            <Input
              value={subject()}
              onInput={(e) => setSubject(e.currentTarget.value)}
              placeholder="Re: …"
            />
          </Field>
        </div>
        <div class="mt-4">
          <Field label="What they wrote" helper="Paste the email body — quoted prior text is fine, Brief keeps it.">
            <textarea
              rows={12}
              value={body()}
              onInput={(e) => setBody(e.currentTarget.value)}
              class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y min-h-[200px] leading-relaxed"
              placeholder="Paste the email body…"
            />
          </Field>
        </div>
        <Show when={error()}>
          <div class="mt-3 rounded-lg bg-[color:var(--color-danger-tint)] px-3 py-2 text-sm text-[color:var(--color-danger)]">
            {error()}
          </div>
        </Show>
      </SlideOver>
    </>
  );
}
