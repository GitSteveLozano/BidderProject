/**
 * <Button> — single source of truth for buttons across Brief.
 *
 * Variants: default | accent | ghost | danger
 * Sizes:    sm | md (default) | lg
 *
 * If `icon` is set without `children`, you MUST pass `aria-label`.
 * Class composition mirrors design/spec/class-vocabulary.md → Buttons.
 */
import { Show, type JSX, type ParentComponent } from 'solid-js';

type Variant = 'default' | 'accent' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  wide?: boolean;
  icon?: JSX.Element;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: MouseEvent) => void;
  'aria-label'?: string;
  class?: string;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  default:
    'bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-[color:var(--color-ink)] ' +
    'hover:bg-[color:var(--color-surface-2)] hover:border-[color:var(--color-line-strong)]',
  accent:
    'bg-[color:var(--color-accent)] border border-[color:var(--color-accent)] text-[color:var(--color-accent-ink)] ' +
    'hover:brightness-95',
  ghost:
    'bg-transparent border border-transparent text-[color:var(--color-ink)] ' +
    'hover:bg-[color:var(--color-surface)]',
  danger:
    'bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-[color:var(--color-danger)] ' +
    'hover:bg-[color:var(--color-surface-2)]',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-2.5 py-[5px] text-[12px]',
  md: 'px-3.5 py-2 text-[13px]',
  lg: 'px-5 py-3 text-sm',
};

const Button: ParentComponent<ButtonProps> = (props) => (
  <button
    type={props.type ?? 'button'}
    disabled={props.disabled}
    onClick={props.onClick}
    aria-label={props['aria-label']}
    class={[
      'inline-flex items-center justify-center gap-[7px] rounded-lg font-medium whitespace-nowrap',
      'transition-colors duration-100',
      'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]',
      'disabled:opacity-45 disabled:cursor-not-allowed',
      VARIANT_CLASSES[props.variant ?? 'default'],
      SIZE_CLASSES[props.size ?? 'md'],
      props.wide ? 'w-full' : '',
      props.class ?? '',
    ].join(' ')}
  >
    <Show when={props.icon}>
      <span class="inline-flex items-center" aria-hidden="true">{props.icon}</span>
    </Show>
    {props.children}
  </button>
);

export default Button;
