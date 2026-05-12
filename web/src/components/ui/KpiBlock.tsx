/**
 * <KpiBlock> — label + big number + optional delta + optional sparkline.
 *
 * Caller pre-formats the value (this component never formats — it
 * doesn't know whether to render "$1,234.56" or "$184k"). Use the
 * compact-currency helper for KPI tiles per design/spec/README.md.
 */
import { Show, type Component, type JSX } from 'solid-js';

interface KpiBlockProps {
  label: string;
  value: JSX.Element | string;
  delta?: {
    value: string;
    direction: 'up' | 'down' | 'flat';
  };
  href?: string;
}

const KpiBlock: Component<KpiBlockProps> = (props) => {
  const inner = (
    <div class="flex flex-col gap-1">
      <span class="text-[11px] font-mono text-[color:var(--color-muted)] uppercase tracking-[0.08em]">
        {props.label}
      </span>
      <span class="font-serif text-kpi font-medium tabular-nums leading-none">
        {props.value}
      </span>
      <Show when={props.delta}>
        <span
          aria-label={`${props.delta!.direction === 'up' ? 'up' : props.delta!.direction === 'down' ? 'down' : 'flat'} ${props.delta!.value}`}
          class={[
            'text-[11px] font-mono inline-flex items-center gap-1',
            props.delta!.direction === 'up' ? 'text-[color:var(--color-good)]' : '',
            props.delta!.direction === 'down' ? 'text-[color:var(--color-danger)]' : '',
            props.delta!.direction === 'flat' ? 'text-[color:var(--color-muted)]' : '',
          ].join(' ')}
        >
          <span aria-hidden="true">
            {props.delta!.direction === 'up' ? '↑' : props.delta!.direction === 'down' ? '↓' : '→'}
          </span>
          {props.delta!.value}
        </span>
      </Show>
    </div>
  );
  return (
    <Show when={props.href} fallback={inner}>
      <a
        href={props.href}
        class="block hover:bg-[color:var(--color-surface-2)] rounded-lg p-2 -m-2 transition-colors"
      >
        {inner}
      </a>
    </Show>
  );
};

export default KpiBlock;
