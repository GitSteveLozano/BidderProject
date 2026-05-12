/**
 * <JobActionDrawer> — same UX as ReplyNudgeDrawer but for jobs.
 *
 * Two modes:
 *   - 'update'   — POST /api/job/draft-update     (full status update)
 *   - 'check-in' — POST /api/job/draft-check-in   (coordination ping)
 *
 * Renders the same Why-this-draft + Best-time-to-send insight panels
 * the quote drawers use, so the operator gets consistent grounding
 * across surfaces.
 */
import { createEffect, createSignal, Show, onCleanup } from 'solid-js';
import SlideOver from '@/components/ui/SlideOver';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';
import Pill from '@/components/ui/Pill';
import { ChannelPicker } from '@/components/quotes/ReplyNudgeDrawer';

export type JobActionMode = 'update' | 'check-in';

interface JobRef {
  id: string;
  ref: string;
  project_title: string;
  client_name: string;
  state: 'SCHEDULED' | 'INPROGRESS' | 'CLOSED';
  variance_pct?: number | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  mode: JobActionMode;
  job: JobRef | null;
}

export default function JobActionDrawer(props: Props) {
  const [subject, setSubject] = createSignal('');
  const [body, setBody] = createSignal('');
  const [streaming, setStreaming] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sending, setSending] = createSignal(false);
  const [channel, setChannel] = createSignal<'email' | 'sms'>('email');
  let abortController: AbortController | null = null;
  let userTouched = false;

  createEffect(() => {
    if (!props.open || !props.job) return;
    userTouched = false;
    setBody('');
    setError(null);

    const endpoint = props.mode === 'update'
      ? '/api/job/draft-update'
      : '/api/job/draft-check-in';

    abortController?.abort();
    abortController = new AbortController();
    const ac = abortController;
    setStreaming(true);

    (async () => {
      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job_id: props.job!.id }),
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
    if (!props.job) return;
    setSending(true);
    setError(null);
    try {
      const resp = await fetch('/api/job/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          job_id: props.job.id,
          kind: props.mode === 'check-in' ? 'check-in' : 'update',
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

  const eyebrow = () =>
    props.mode === 'update' ? 'Brief drafted a status update' : 'Brief drafted a check-in';
  const reasoning = () => draftReasoning(props.mode, props.job);
  const sendTime = () => bestSendTime(props.job);

  return (
    <SlideOver
      open={props.open}
      onClose={props.onClose}
      eyebrow={eyebrow()}
      title={props.job ? `${props.job.project_title} · ${props.job.ref}` : 'Drafting…'}
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

      {/* Why this draft */}
      <Show when={!streaming() && body().trim().length > 0}>
        <div class="mt-5 rounded-lg bg-[color:var(--color-accent-tint)] px-4 py-3 flex gap-2.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-[color:var(--color-accent)] mt-0.5 shrink-0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <path d="M7 1l1.6 4.3h4.4l-3.5 2.8 1.3 4.3-3.8-2.6-3.8 2.6 1.3-4.3-3.5-2.8h4.4z" />
          </svg>
          <p class="text-[13px] leading-relaxed text-[color:var(--color-ink-2)] font-serif">
            <strong class="font-medium">Why this draft.</strong> {reasoning()}
          </p>
        </div>
      </Show>

      {/* Best time to send */}
      <Show when={!streaming() && body().trim().length > 0}>
        <div class="mt-3 rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-line)] px-4 py-3 flex gap-2.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-[color:var(--color-muted)] mt-0.5 shrink-0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 4v3l2 1.5" />
          </svg>
          <p class="text-[13px] leading-relaxed text-[color:var(--color-ink-2)] font-serif flex-1">
            <strong class="font-medium">Best time to send: </strong>
            <span class="font-medium">{sendTime().when}</span>
            <span class="text-[color:var(--color-muted)]">. {sendTime().why}</span>
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

function draftReasoning(mode: JobActionMode, job: JobRef | null): string {
  if (!job) return '';
  const variance = job.variance_pct == null ? null : Number(job.variance_pct);
  if (mode === 'update') {
    if (variance != null && variance < -2) {
      return `Job is running ahead of plan — tone leans confident. Specific numbers; no oversell.`;
    }
    if (variance != null && variance > 5) {
      return `Variance is starting to add up. Tone is direct, acknowledges the gap, and offers a concrete next step before the client asks.`;
    }
    return `Job is on track. Status update keeps the client informed without burying them in numbers, ending with the next concrete milestone.`;
  }
  // check-in
  return `Coordination-only note. No status reporting, no pressure — just a clear ask with a proposed window so it's easy to reply yes.`;
}

function bestSendTime(job: JobRef | null): { when: string; why: string } {
  if (!job) return { when: 'Send now', why: '' };
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (day >= 1 && day <= 5 && hour >= 9 && hour < 11) {
    return {
      when: 'Send now',
      why: 'Weekday mid-morning gets the highest open-rate from this client.',
    };
  }
  const target = nextWeekdayMorning(now);
  const label = sameDay(target, addDays(now, 1)) ? 'Tomorrow' : weekdayLabel(target);
  return {
    when: `${label}, 9:10 AM`,
    why: 'Builder-to-builder check-ins read best at the start of the workday.',
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
