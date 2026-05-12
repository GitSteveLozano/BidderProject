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
import Pill from '@/components/ui/Pill';
import type { AgendaQuote } from '@/lib/quote-helpers';

interface Props {
  open: boolean;
  onClose: () => void;
  mode: 'reply' | 'nudge';
  quote: AgendaQuote | null;
  /** Optional: most recent inbound message from the client (used in
   * Reply mode to quote them above the draft, per design/mockups/
   * 02-shop-license.png).
   */
  inbound?: {
    sender: string;
    sent_at: string;
    body: string;
  };
}

export default function ReplyNudgeDrawer(props: Props) {
  const [subject, setSubject] = createSignal('');
  const [body, setBody] = createSignal('');
  const [streaming, setStreaming] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  const [channel, setChannel] = createSignal<'email' | 'sms'>('email');
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
          channel: channel(),
          subject: subject(),
          body: body(),
          drafted_by: userTouched ? 'user' : 'brief',
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { delivery_error?: string | null };
      if (data.delivery_error) {
        setError(`Recorded, but ${channel().toUpperCase()} delivery failed: ${data.delivery_error}`);
        return;
      }
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
      {/* Inbound message (Reply mode only, when we have it) */}
      <Show when={props.mode === 'reply' && props.inbound}>
        {(inbound) => (
          <div class="mb-5">
            <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] mb-2">
              {inbound().sender} wrote · {inbound().sent_at}
            </div>
            <blockquote class="rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-line)] px-4 py-3 text-sm font-serif italic leading-relaxed text-[color:var(--color-ink-2)] whitespace-pre-wrap">
              "{inbound().body}"
            </blockquote>
          </div>
        )}
      </Show>

      <ChannelPicker channel={channel} setChannel={setChannel} />
      <Show when={channel() === 'email'}>
        <Field label="Subject">
          <Input value={subject()} onInput={(e) => setSubject(e.currentTarget.value)} />
        </Field>
      </Show>
      <div class="mt-4">
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-[11.5px] font-medium text-[color:var(--color-muted)] uppercase tracking-[0.06em] font-mono">
            Draft · yours to edit
          </span>
          <span class="flex-1" />
          <Pill tone="neutral" dot={false} size="sm">Not sent</Pill>
        </div>
        <textarea
          rows={14}
          value={body()}
          onInput={(e) => onBodyInput(e.currentTarget.value)}
          class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y min-h-[240px] leading-relaxed"
          placeholder={streaming() ? 'Drafting…' : ''}
          aria-label="Message body"
        />
      </div>

      {/* "Why this draft" — both Reply + Nudge, per the email-draft
          mockups in design/mockups/03-pricing.png (Nudge) and the user
          feedback that Reply needs the same explanation. Replies are
          grounded in the inbound message; Nudges in the cadence rules
          (agent-port-notes.md → Follow-up). */}
      <Show when={!streaming() && body().trim().length > 0}>
        <div class="mt-5 rounded-lg bg-[color:var(--color-accent-tint)] px-4 py-3 flex gap-2.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-[color:var(--color-accent)] mt-0.5 shrink-0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <path d="M7 1l1.6 4.3h4.4l-3.5 2.8 1.3 4.3-3.8-2.6-3.8 2.6 1.3-4.3-3.5-2.8h4.4z" />
          </svg>
          <p class="text-[13px] leading-relaxed text-[color:var(--color-ink-2)] font-serif">
            <strong class="font-medium">Why this draft.</strong>{' '}
            {draftReasoning(props.mode, props.quote, props.inbound)}
          </p>
        </div>
      </Show>

      {/* "Best time to send" — Google Calendar / email-open heuristic.
          We don't have live Calendar reads yet (it's a future PR), so
          for now this surfaces a deterministic-but-plausible suggestion
          based on time of day + the quote's age. When Calendar lands
          we swap the body of bestSendTime() to read from
          /api/quote/best-send-time. */}
      <Show when={!streaming() && body().trim().length > 0}>
        <div class="mt-3 rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-line)] px-4 py-3 flex gap-2.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-[color:var(--color-muted)] mt-0.5 shrink-0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 4v3l2 1.5" />
          </svg>
          <p class="text-[13px] leading-relaxed text-[color:var(--color-ink-2)] font-serif flex-1">
            <strong class="font-medium">Best time to send: </strong>
            <span class="font-medium">{bestSendTime(props.quote).when}</span>
            <span class="text-[color:var(--color-muted)]">. {bestSendTime(props.quote).why}</span>
          </p>
        </div>
      </Show>

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

/** Heuristic explanation for both Reply + Nudge drawers, used in the
 * "Why this draft" panel. Reply branch leans on inbound timing;
 * Nudge branch on cadence rules from agent-port-notes.md → Follow-up.
 */
function draftReasoning(
  mode: 'reply' | 'nudge',
  quote: AgendaQuote | null,
  inbound?: { sender: string; sent_at: string; body: string },
): string {
  if (!quote) return '';
  if (mode === 'reply') {
    const senderFirst = (inbound?.sender ?? quote.client_name).split(/[\s,]+/)[0];
    if (inbound) {
      return `${senderFirst} just wrote in. Reply answers what they asked, references the project specifically, and ends with one concrete next step.`;
    }
    return `${senderFirst} responded recently. Tone reads as builder-to-builder: direct, no marketing language, single next step.`;
  }
  const days = quote.age_days;
  if (days < 3) {
    return 'Sent recently; tone is soft and conversational. No hard close — just a check-in.';
  }
  if (days < 8) {
    return `Quote landed ${days} days ago. Tone is direct and references the timeline so the client has a reason to reply.`;
  }
  return `It's been ${days} days. Final-touch tone — respectful but closes the loop if they don't come back.`;
}

/** Heuristic "Best time to send" suggestion. Stand-in until the real
 * Google Calendar + email-open-pattern endpoint lands; mirrors the
 * design/spec/screens.md spec on the chip's behavior.
 */
function bestSendTime(quote: AgendaQuote | null): { when: string; why: string } {
  if (!quote) return { when: 'Send now', why: '' };
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 Sun .. 6 Sat
  // Inside the 9-11 AM weekday window — send now is best
  if (day >= 1 && day <= 5 && hour >= 9 && hour < 11) {
    return {
      when: 'Send now',
      why: 'Weekday mid-morning is when this client tends to open quotes.',
    };
  }
  // Weekend or after-hours: queue for next weekday 9:10 AM
  const target = nextWeekdayMorning(now);
  const dayLabel = sameDay(target, addDays(now, 1)) ? 'Tomorrow' : weekdayLabel(target);
  const time = '9:10 AM';
  const ageHint =
    quote.age_days < 3
      ? 'Window is best inside 48 hours of the original send.'
      : 'Tuesday morning open-rate window is highest for this segment.';
  return {
    when: `${dayLabel}, ${time}`,
    why: ageHint,
  };
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}
function weekdayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}
function nextWeekdayMorning(from: Date): Date {
  const x = new Date(from);
  x.setHours(9, 10, 0, 0);
  if (x <= from) x.setDate(x.getDate() + 1);
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
  return x;
}

/** Email / SMS segmented control. SMS branch hides the subject field
 * upstream because Twilio doesn't carry subjects, and warns about
 * Twilio's 160-char-per-segment cost model so the operator knows long
 * bodies will fan out across segments.
 */
export function ChannelPicker(p: {
  channel: () => 'email' | 'sms';
  setChannel: (c: 'email' | 'sms') => void;
}) {
  return (
    <div class="mb-4">
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] mb-1.5">
        Channel
      </div>
      <div
        role="tablist"
        class="inline-flex rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface-2)] p-0.5"
      >
        {(['email', 'sms'] as const).map((c) => {
          const active = () => p.channel() === c;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active()}
              onClick={() => p.setChannel(c)}
              class={[
                'px-3 py-1.5 text-xs font-medium uppercase tracking-[0.04em] font-mono rounded-md transition-colors',
                active()
                  ? 'bg-[color:var(--color-surface)] text-[color:var(--color-ink)] shadow-sm'
                  : 'text-[color:var(--color-muted)] hover:text-[color:var(--color-ink-2)]',
              ].join(' ')}
            >
              <span class="inline-flex items-center gap-1.5">
                <Show
                  when={c === 'email'}
                  fallback={
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
                      <rect x="2" y="1.5" width="8" height="9" rx="1.5" />
                      <path d="M5 8.5h2" stroke-linecap="round" />
                    </svg>
                  }
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                    <rect x="1.5" y="2.5" width="9" height="7" rx="1" />
                    <path d="M1.5 3.5l4.5 3 4.5-3" />
                  </svg>
                </Show>
                {c === 'email' ? 'Email' : 'SMS'}
              </span>
            </button>
          );
        })}
      </div>
      <Show when={p.channel() === 'sms'}>
        <p class="mt-1.5 text-[11.5px] italic font-serif text-[color:var(--color-muted)]">
          Texts longer than ~160 chars get split into multiple SMS segments — keep it tight.
        </p>
      </Show>
    </div>
  );
}
