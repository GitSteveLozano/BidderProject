/**
 * <ReplyNudgeDrawer> — slide-over for drafting a reply or nudge.
 *
 * Opens immediately with skeleton placeholders, then SSE-streams the
 * draft body from /api/quote/draft-reply or /api/quote/draft-nudge.
 * First user keystroke in the body field aborts the stream so the
 * operator can edit without fighting the model.
 *
 * On Send: POST /api/quote/message; closes drawer.
 */
import { createEffect, createSignal, Show, onCleanup } from 'solid-js';
import SlideOver from '@/components/ui/SlideOver';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';
import type { AgendaQuote } from '@/lib/quote-helpers';

interface Props {
  open: boolean;
  onClose: () => void;
  mode: 'reply' | 'nudge';
  quote: AgendaQuote | null;
}

export default function ReplyNudgeDrawer(props: Props) {
  const [subject, setSubject] = createSignal('');
  const [body, setBody] = createSignal('');
  const [streaming, setStreaming] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  let abortController: AbortController | null = null;
  let userTouched = false;

  // Kick off the draft stream when the drawer opens
  createEffect(() => {
    if (!props.open || !props.quote) return;
    userTouched = false;
    setSubject(props.mode === 'reply' ? `Re: ${props.quote.project_title}` : `Following up — ${props.quote.project_title}`);
    setBody('');
    setError(null);

    const endpoint = props.mode === 'reply'
      ? '/api/quote/draft-reply'
      : '/api/quote/draft-nudge';

    abortController?.abort();
    abortController = new AbortController();
    const ac = abortController;
    setStreaming(true);

    (async () => {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quote_id: props.quote!.id }),
          signal: ac.signal,
        });
        if (!resp.ok) throw new Error(`Server returned ${resp.status}: ${await resp.text()}`);
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (userTouched) {
            ac.abort();
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const events = buf.split('\n\n');
          buf = events.pop() ?? '';
          for (const block of events) {
            const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            const payload = JSON.parse(dataLine.slice(6));
            if (payload.type === 'token') {
              setBody(body() + payload.text);
            } else if (payload.type === 'subject') {
              setSubject(payload.text);
            } else if (payload.type === 'error') {
              setError(payload.message);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setStreaming(false);
      }
    })();
  });

  onCleanup(() => abortController?.abort());

  const onBodyInput = (text: string) => {
    if (!userTouched && streaming()) {
      userTouched = true;
      abortController?.abort();
      setStreaming(false);
    }
    setBody(text);
  };

  const send = async () => {
    if (!props.quote) return;
    setSending(true);
    setError(null);
    try {
      const resp = await fetch('/api/quote/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quote_id: props.quote.id,
          channel: 'email',
          subject: subject(),
          body: body(),
          drafted_by: userTouched ? 'user' : 'brief',
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const eyebrow = () => props.mode === 'reply' ? 'Brief drafted a reply' : 'Brief drafted a nudge';

  return (
    <SlideOver
      open={props.open}
      onClose={props.onClose}
      eyebrow={eyebrow()}
      title={props.quote ? `${props.quote.client_name} · ${props.quote.ref}` : 'Drafting…'}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          <div class="flex-1" />
          <Button
            variant="accent"
            disabled={sending() || streaming() || !body().trim()}
            onClick={send}
          >
            {sending() ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <Field label="Subject">
        <Input value={subject()} onInput={(e) => setSubject(e.currentTarget.value)} />
      </Field>
      <div class="mt-4">
        <Field label="Body">
          <textarea
            rows={14}
            value={body()}
            onInput={(e) => onBodyInput(e.currentTarget.value)}
            class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y min-h-[240px] leading-relaxed"
            placeholder={streaming() ? 'Drafting…' : ''}
          />
        </Field>
      </div>
      <Show when={error()}>
        <div class="mt-3 rounded-lg bg-[color:var(--color-danger-tint)] px-3 py-2 text-sm text-[color:var(--color-danger)]">
          {error()}
        </div>
      </Show>
      <Show when={streaming()}>
        <div class="mt-2 text-xs italic font-serif text-[color:var(--color-muted)]">
          Brief is drafting. Edit anything to take over.
        </div>
      </Show>
    </SlideOver>
  );
}
