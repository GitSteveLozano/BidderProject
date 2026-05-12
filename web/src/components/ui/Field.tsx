/**
 * <Field> — label + input wrapper. Use for forms.
 *
 * Renders a mono-cased label above the input, with optional helper or
 * error text below. Pass the input via children so the component
 * stays input-type-agnostic.
 */
import { Show, type ParentComponent } from 'solid-js';

interface FieldProps {
  label: string;
  helper?: string;
  error?: string;
  id?: string;
  required?: boolean;
  class?: string;
}

const Field: ParentComponent<FieldProps> = (props) => (
  <div class={['flex flex-col gap-1.5', props.class ?? ''].join(' ')}>
    <label
      for={props.id}
      class="text-[11.5px] font-medium text-[color:var(--color-muted)] uppercase tracking-[0.06em] font-mono"
    >
      {props.label}
      <Show when={props.required}>
        <span class="ml-0.5 text-[color:var(--color-danger)]" aria-hidden="true">*</span>
      </Show>
    </label>
    {props.children}
    <Show when={props.error} fallback={
      <Show when={props.helper}>
        <span class="text-xs text-[color:var(--color-muted)]">{props.helper}</span>
      </Show>
    }>
      <span class="text-xs text-[color:var(--color-danger)]" role="alert">{props.error}</span>
    </Show>
  </div>
);

/** Standalone input styled to match Field. Use for plain controls. */
export const Input: ParentComponent<
  { class?: string } & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class'>
> = (props) => {
  const { class: cls, children: _c, ...rest } = props;
  return (
    <input
      {...rest}
      class={[
        'w-full px-3 py-2.5 rounded-lg text-sm text-[color:var(--color-ink)] font-sans',
        'bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)]',
        'focus:outline-none focus:border-[color:var(--color-accent)]',
        'focus:shadow-[0_0_0_3px_var(--color-accent-tint)]',
        'placeholder:text-[color:var(--color-muted-2)]',
        cls ?? '',
      ].join(' ')}
    />
  );
};

import type { JSX } from 'solid-js';

export default Field;
