/**
 * <Stepper> — numbered horizontal step indicator with completed checkmarks.
 *
 * Active step has aria-current="step". Completed steps are optionally
 * clickable via onStepClick — gives the user a way to back-navigate
 * without losing form state.
 */
import { For, Show, type Component } from 'solid-js';

interface StepperProps {
  steps: Array<{ id: string; label: string }>;
  current: string;
  completed: string[];
  onStepClick?: (id: string) => void;
}

const Stepper: Component<StepperProps> = (props) => {
  const stateOf = (id: string) =>
    id === props.current
      ? 'active'
      : props.completed.includes(id)
        ? 'done'
        : 'future';
  return (
    <ol class="flex items-center gap-2">
      <For each={props.steps}>
        {(step, i) => {
          const s = () => stateOf(step.id);
          const interactive = () => props.onStepClick && s() === 'done';
          return (
            <>
              <li
                class="flex items-center gap-2"
                aria-current={s() === 'active' ? 'step' : undefined}
              >
                <button
                  type="button"
                  disabled={!interactive()}
                  onClick={() => props.onStepClick?.(step.id)}
                  class={[
                    'inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[10px] font-semibold',
                    'transition-colors',
                    s() === 'active'
                      ? 'bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)]'
                      : s() === 'done'
                        ? 'bg-[color:var(--color-accent-tint)] text-[color:var(--color-accent)] cursor-pointer'
                        : 'bg-[color:var(--color-bg-2)] text-[color:var(--color-muted)]',
                    interactive() ? 'hover:brightness-95' : 'cursor-default',
                  ].join(' ')}
                  aria-label={`${step.label}${s() === 'done' ? ' (completed)' : ''}`}
                >
                  <Show when={s() === 'done'} fallback={i() + 1}>
                    <span aria-hidden="true">✓</span>
                  </Show>
                </button>
                <span
                  class={[
                    'font-mono text-[12px]',
                    // Mobile: only show the active step's label;
                    // desktop: show all. Saves horizontal space at
                    // 5–7 steps without losing the active context.
                    s() === 'active' ? 'inline' : 'hidden sm:inline',
                    s() === 'active' ? 'text-[color:var(--color-ink)] font-semibold' : '',
                    s() === 'done' ? 'text-[color:var(--color-muted)]' : '',
                    s() === 'future' ? 'text-[color:var(--color-muted-2)]' : '',
                  ].join(' ')}
                >
                  {step.label}
                </span>
              </li>
              <Show when={i() < props.steps.length - 1}>
                <span class="text-[color:var(--color-muted-2)] hidden sm:inline" aria-hidden="true">/</span>
              </Show>
            </>
          );
        }}
      </For>
    </ol>
  );
};

export default Stepper;
