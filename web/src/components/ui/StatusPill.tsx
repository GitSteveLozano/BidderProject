/**
 * <StatusPill> — single source of truth for quote/job state → pill mapping.
 *
 * Always renders aria-label="Status: <Label>" so screen readers get the
 * state regardless of the leading dot or any color cue.
 */
import { Show, type Component } from 'solid-js';

export type QuoteState = 'DRAFT' | 'SENT' | 'AWAITING' | 'RESPONDED' | 'WON' | 'LOST';
export type JobState = 'SCHEDULED' | 'INPROGRESS' | 'CLOSED';
export type AnyState = QuoteState | JobState;

interface StatusPillProps {
  state: AnyState;
  size?: 'sm' | 'md';
}

const META: Record<
  AnyState,
  { label: string; classes: string }
> = {
  DRAFT:      { label: 'Draft',       classes: 'bg-[color:var(--color-bg-2)]      text-[color:var(--color-muted)]  border-[color:var(--color-line-2)]' },
  SENT:       { label: 'Sent',        classes: 'bg-[color:var(--color-info-tint)] text-[color:var(--color-info)]' },
  AWAITING:   { label: 'Awaiting',    classes: 'bg-[color:var(--color-warn-tint)] text-[color:var(--color-warn)]' },
  RESPONDED:  { label: 'Responded',   classes: 'bg-[color:var(--color-accent-tint)] text-[color:var(--color-accent)]' },
  WON:        { label: 'Won',         classes: 'bg-[color:var(--color-good-tint)] text-[color:var(--color-good)]' },
  LOST:       { label: 'Lost',        classes: 'bg-[color:var(--color-bg-2)]      text-[color:var(--color-muted)]  border-[color:var(--color-line-2)]' },
  SCHEDULED:  { label: 'Scheduled',   classes: 'bg-[color:var(--color-warn-tint)] text-[color:var(--color-warn)]' },
  INPROGRESS: { label: 'In progress', classes: 'bg-[color:var(--color-info-tint)] text-[color:var(--color-info)]' },
  CLOSED:     { label: 'Closed',      classes: 'bg-[color:var(--color-good-tint)] text-[color:var(--color-good)]' },
};

const StatusPill: Component<StatusPillProps> = (props) => {
  const meta = () => META[props.state];
  const sizeCls = () =>
    props.size === 'sm' ? 'text-[10px] px-1.5 py-px' : 'text-[11px] px-2 py-[2px]';
  return (
    <Show when={meta()}>
      <span
        aria-label={`Status: ${meta().label}`}
        class={[
          'inline-flex items-center gap-1.5 rounded-full font-mono font-medium uppercase tracking-[0.04em] whitespace-nowrap',
          'border border-transparent',
          sizeCls(),
          meta().classes,
        ].join(' ')}
      >
        <span
          class="w-[5px] h-[5px] rounded-full bg-current"
          aria-hidden="true"
        />
        {meta().label}
      </span>
    </Show>
  );
};

export default StatusPill;
