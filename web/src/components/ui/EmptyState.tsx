/**
 * <EmptyState> — primary screens, not error screens.
 *
 * Layout: centered column, max-w-[480px]. Eyebrow → serif title (24px)
 * → muted body (14px) → primary + secondary buttons.
 *
 * Empty-state copy lives in design/spec/empty-states.md.
 */
import { Show, type Component, type JSX } from 'solid-js';
import Button from './Button';

interface EmptyStateProps {
  eyebrow?: string;
  title: string;
  body?: string | JSX.Element;
  primary?: { label: string; onClick?: () => void; href?: string };
  secondary?: { label: string; onClick?: () => void; href?: string };
  /** Inline SVG element if you want an illustration above the eyebrow. */
  illustration?: JSX.Element;
}

const EmptyState: Component<EmptyStateProps> = (props) => (
  <div class="mx-auto max-w-[480px] text-center py-10 px-6">
    <Show when={props.illustration}>
      <div class="mb-4 inline-flex w-12 h-12 text-[color:var(--color-muted-2)]" aria-hidden="true">
        {props.illustration}
      </div>
    </Show>
    <Show when={props.eyebrow}>
      <div class="text-eyebrow font-mono uppercase tracking-[0.08em] text-[color:var(--color-muted-2)] mb-2">
        {props.eyebrow}
      </div>
    </Show>
    <h2 class="font-serif text-[24px] font-medium leading-tight text-[color:var(--color-ink)]">
      {props.title}
    </h2>
    <Show when={props.body}>
      <p class="mt-3 text-sm text-[color:var(--color-muted)] leading-relaxed">
        {props.body}
      </p>
    </Show>
    <Show when={props.primary || props.secondary}>
      <div class="mt-6 flex items-center justify-center gap-2">
        <Show when={props.primary}>
          {(p) => (
            <Show when={p().href} fallback={
              <Button variant="accent" onClick={p().onClick}>{p().label}</Button>
            }>
              <a
                href={p().href}
                class="inline-flex items-center justify-center gap-[7px] rounded-lg font-medium whitespace-nowrap px-3.5 py-2 text-[13px] bg-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] hover:brightness-95"
              >
                {p().label}
              </a>
            </Show>
          )}
        </Show>
        <Show when={props.secondary}>
          {(s) => (
            <Show when={s().href} fallback={
              <Button variant="ghost" onClick={s().onClick}>{s().label}</Button>
            }>
              <a
                href={s().href}
                class="inline-flex items-center justify-center gap-[7px] rounded-lg font-medium whitespace-nowrap px-3.5 py-2 text-[13px] text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-2)]"
              >
                {s().label}
              </a>
            </Show>
          )}
        </Show>
      </div>
    </Show>
  </div>
);

export default EmptyState;
