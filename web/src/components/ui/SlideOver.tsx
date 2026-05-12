/**
 * <SlideOver> — right-side drawer with focus trap + Esc-to-close.
 *
 * Behavior contract (per design/spec/primitives.md):
 *   - Slides in from right, 180ms ease-out, opacity 0→1 on backdrop
 *   - Backdrop click closes; Esc closes; focus traps inside
 *   - On open: focus moves to first focusable element
 *   - On close: focus returns to the previously-focused element
 *   - Scrolls internally if content exceeds viewport
 *
 * Used by Reply/Nudge in /quotes and later by Send-quote, etc.
 */
import { createEffect, onCleanup, Show, type JSX, type ParentComponent } from 'solid-js';

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  width?: number;
  footer?: JSX.Element;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SlideOver: ParentComponent<SlideOverProps> = (props) => {
  let panel: HTMLDivElement | undefined;
  let previousFocus: HTMLElement | null = null;

  createEffect(() => {
    if (!props.open) return;
    previousFocus = (document.activeElement as HTMLElement) ?? null;

    // Focus first focusable element inside the panel
    requestAnimationFrame(() => {
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    onCleanup(() => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previousFocus?.focus();
    });
  });

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <button
          type="button"
          aria-label="Close drawer"
          onClick={() => props.onClose()}
          class="absolute inset-0 bg-black/30 transition-opacity duration-150"
        />
        <div
          ref={panel}
          style={{ width: `${props.width ?? 560}px`, 'max-width': '92vw' }}
          class={[
            'absolute right-0 top-0 h-full',
            'bg-[color:var(--color-surface)] border-l border-[color:var(--color-line)]',
            'shadow-[var(--shadow-md)] flex flex-col',
            'animate-[slide-in-right_180ms_ease-out]',
          ].join(' ')}
        >
          <div class="px-5 pt-5 pb-3 border-b border-[color:var(--color-line)]">
            <Show when={props.eyebrow}>
              <div class="text-eyebrow font-mono text-[color:var(--color-muted)] uppercase tracking-[0.08em] mb-1">
                {props.eyebrow}
              </div>
            </Show>
            <h2 class="font-serif text-[20px] font-medium leading-tight">
              {props.title}
            </h2>
          </div>
          <div class="flex-1 overflow-y-auto p-5">{props.children}</div>
          <Show when={props.footer}>
            <div class="px-5 py-3.5 border-t border-[color:var(--color-line)] bg-[color:var(--color-surface-2)] flex items-center gap-2">
              {props.footer}
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default SlideOver;
