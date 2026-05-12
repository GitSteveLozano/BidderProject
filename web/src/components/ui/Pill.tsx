/**
 * <Pill> — generic pill (badge) with tone variants. Used for
 * non-status decorations like "high confidence", "+12% over",
 * relationship tags. StatusPill is the specialized wrapper for
 * quote/job state.
 */
import { Show, type ParentComponent } from 'solid-js';

type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'info' | 'accent';

const TONE: Record<Tone, string> = {
  neutral: 'bg-[color:var(--color-bg-2)] text-[color:var(--color-muted)] border-[color:var(--color-line-2)]',
  good:    'bg-[color:var(--color-good-tint)] text-[color:var(--color-good)]',
  warn:    'bg-[color:var(--color-warn-tint)] text-[color:var(--color-warn)]',
  danger:  'bg-[color:var(--color-danger-tint)] text-[color:var(--color-danger)]',
  info:    'bg-[color:var(--color-info-tint)] text-[color:var(--color-info)]',
  accent:  'bg-[color:var(--color-accent-tint)] text-[color:var(--color-accent)]',
};

interface PillProps {
  tone?: Tone;
  /** Show the leading dot. Defaults true for status-like pills. */
  dot?: boolean;
  size?: 'sm' | 'md';
  class?: string;
}

const Pill: ParentComponent<PillProps> = (props) => (
  <span
    class={[
      'inline-flex items-center gap-1.5 rounded-full font-mono font-medium uppercase tracking-[0.04em] whitespace-nowrap',
      'border border-transparent',
      props.size === 'sm' ? 'text-[10px] px-1.5 py-px' : 'text-[11px] px-2 py-[2px]',
      TONE[props.tone ?? 'neutral'],
      props.class ?? '',
    ].join(' ')}
  >
    <Show when={props.dot !== false}>
      <span class="w-[5px] h-[5px] rounded-full bg-current" aria-hidden="true" />
    </Show>
    {props.children}
  </span>
);

export default Pill;
