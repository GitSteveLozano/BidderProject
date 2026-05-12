/**
 * <MarkOutcomeButtons> — Mark won / Mark lost actions on quote detail.
 *
 * Won opens a slide-over with optional scheduled_start / scheduled_end
 * / crew_summary fields so the operator pencils the job in at the
 * moment they accept. Submit fires /api/quote/mark-won which creates
 * the job row + transitions the quote.
 *
 * Lost opens a postmortem slide-over: reason + competitor + winning
 * bid amount. These flow into outcome_* columns on quotes — signal
 * the recommendation engine uses later when suggesting margin moves.
 */
import { createSignal, Show } from 'solid-js';
import SlideOver from '@/components/ui/SlideOver';
import Button from '@/components/ui/Button';
import Field, { Input } from '@/components/ui/Field';

interface Props {
  quote_id: string;
  state: 'DRAFT' | 'SENT' | 'AWAITING' | 'RESPONDED' | 'WON' | 'LOST';
}

export default function MarkOutcomeButtons(props: Props) {
  const [winOpen, setWinOpen] = createSignal(false);
  const [lostOpen, setLostOpen] = createSignal(false);

  const [scheduledStart, setScheduledStart] = createSignal('');
  const [scheduledEnd, setScheduledEnd] = createSignal('');
  const [crewSummary, setCrewSummary] = createSignal('');
  const [winBusy, setWinBusy] = createSignal(false);
  const [winError, setWinError] = createSignal<string | null>(null);

  const [reason, setReason] = createSignal('');
  const [competitor, setCompetitor] = createSignal('');
  const [winningBid, setWinningBid] = createSignal('');
  const [lostBusy, setLostBusy] = createSignal(false);
  const [lostError, setLostError] = createSignal<string | null>(null);

  const submitWon = async () => {
    setWinBusy(true);
    setWinError(null);
    try {
      const resp = await fetch('/api/quote/mark-won', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quote_id: props.quote_id,
          scheduled_start: scheduledStart() || null,
          scheduled_end: scheduledEnd() || null,
          crew_summary: crewSummary().trim() || null,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as { job?: { id: string; ref: string } };
      if (data.job) {
        window.location.href = `/jobs#${data.job.id}`;
      } else {
        window.location.reload();
      }
    } catch (err) {
      setWinError(err instanceof Error ? err.message : String(err));
    } finally {
      setWinBusy(false);
    }
  };

  const submitLost = async () => {
    setLostBusy(true);
    setLostError(null);
    try {
      const wb = winningBid().trim();
      const resp = await fetch('/api/quote/mark-lost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quote_id: props.quote_id,
          reason: reason().trim() || null,
          competitor: competitor().trim() || null,
          winning_bid: wb ? parseFloat(wb) : null,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      window.location.reload();
    } catch (err) {
      setLostError(err instanceof Error ? err.message : String(err));
    } finally {
      setLostBusy(false);
    }
  };

  // Only show on quotes that are still in motion. WON / LOST already
  // have an outcome captured; DRAFT hasn't gone out.
  const live = () =>
    props.state === 'SENT' || props.state === 'AWAITING' || props.state === 'RESPONDED';

  return (
    <Show when={live()}>
      <div class="inline-flex gap-2">
        <button
          type="button"
          onClick={() => setWinOpen(true)}
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[color:var(--color-good-tint)] text-[color:var(--color-good)] text-[13px] font-medium hover:brightness-95"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2.5 6.5l2.5 2.5 5-5.5" />
          </svg>
          Mark won
        </button>
        <button
          type="button"
          onClick={() => setLostOpen(true)}
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--color-line-2)] bg-[color:var(--color-surface)] text-[13px] font-medium text-[color:var(--color-muted)] hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-ink-2)]"
        >
          Mark lost
        </button>
      </div>

      {/* Won slide-over */}
      <SlideOver
        open={winOpen()}
        onClose={() => setWinOpen(false)}
        eyebrow="Outcome · won"
        title="Pencil in the schedule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWinOpen(false)}>Cancel</Button>
            <div class="flex-1" />
            <Button variant="accent" disabled={winBusy()} onClick={submitWon}>
              {winBusy() ? 'Saving…' : 'Mark won + create job'}
            </Button>
          </>
        }
      >
        <p class="text-sm font-serif italic text-[color:var(--color-muted)] mb-4 leading-relaxed">
          Brief creates a job from this quote so the cost reconciliation tracks
          against the bid. Dates are optional — you can fill them in later from
          the job detail.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <Field label="Scheduled start" helper="YYYY-MM-DD">
            <Input
              type="date"
              value={scheduledStart()}
              onInput={(e) => setScheduledStart(e.currentTarget.value)}
            />
          </Field>
          <Field label="Scheduled end" helper="YYYY-MM-DD">
            <Input
              type="date"
              value={scheduledEnd()}
              onInput={(e) => setScheduledEnd(e.currentTarget.value)}
            />
          </Field>
        </div>
        <div class="mt-3">
          <Field label="Crew" helper="Free-text. 'Iván + 2' is fine — crew table comes later.">
            <Input
              value={crewSummary()}
              onInput={(e) => setCrewSummary(e.currentTarget.value)}
              placeholder="Iván + 2"
            />
          </Field>
        </div>
        <Show when={winError()}>
          <div class="mt-3 rounded-lg bg-[color:var(--color-danger-tint)] px-3 py-2 text-sm text-[color:var(--color-danger)]">
            {winError()}
          </div>
        </Show>
      </SlideOver>

      {/* Lost slide-over */}
      <SlideOver
        open={lostOpen()}
        onClose={() => setLostOpen(false)}
        eyebrow="Outcome · lost"
        title="What did we learn?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLostOpen(false)}>Cancel</Button>
            <div class="flex-1" />
            <Button variant="accent" disabled={lostBusy()} onClick={submitLost}>
              {lostBusy() ? 'Saving…' : 'Mark lost'}
            </Button>
          </>
        }
      >
        <p class="text-sm font-serif italic text-[color:var(--color-muted)] mb-4 leading-relaxed">
          Each loss teaches the recommendation engine. Estimates are fine — if
          you don't know the winning bid, leave it blank.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <Field label="Who won it">
            <Input
              value={competitor()}
              onInput={(e) => setCompetitor(e.currentTarget.value)}
              placeholder="e.g. Acme Stucco"
            />
          </Field>
          <Field label="Their bid ($)" helper="Best guess is OK.">
            <Input
              type="number"
              step="0.01"
              value={winningBid()}
              onInput={(e) => setWinningBid(e.currentTarget.value)}
              placeholder="0.00"
            />
          </Field>
        </div>
        <div class="mt-3">
          <Field label="Why" helper="One sentence is plenty. 'Underbid by 15%', 'Went with their incumbent', etc.">
            <textarea
              rows={4}
              value={reason()}
              onInput={(e) => setReason(e.currentTarget.value)}
              class="w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] focus:outline-none focus:border-[color:var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-tint)] resize-y leading-relaxed"
              placeholder="What tipped it?"
            />
          </Field>
        </div>
        <Show when={lostError()}>
          <div class="mt-3 rounded-lg bg-[color:var(--color-danger-tint)] px-3 py-2 text-sm text-[color:var(--color-danger)]">
            {lostError()}
          </div>
        </Show>
      </SlideOver>
    </Show>
  );
}
