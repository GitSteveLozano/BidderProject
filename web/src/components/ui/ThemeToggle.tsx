/**
 * <ThemeToggle> — switches between paper (light) and site (dark).
 *
 * Persists choice to localStorage('brief-theme') so it survives a
 * full page nav. The Brief.astro layout reads it inline before paint
 * to avoid the flash of wrong theme.
 */
import { createSignal, onMount } from 'solid-js';

const KEY = 'brief-theme';

export default function ThemeToggle() {
  const [theme, setTheme] = createSignal<'paper' | 'site'>('paper');

  onMount(() => {
    const stored = (localStorage.getItem(KEY) as 'paper' | 'site' | null) ?? 'paper';
    setTheme(stored);
    document.documentElement.setAttribute('data-theme', stored);
  });

  const toggle = () => {
    const next = theme() === 'paper' ? 'site' : 'paper';
    setTheme(next);
    localStorage.setItem(KEY, next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[color:var(--color-surface)] border border-[color:var(--color-line-2)] text-sm hover:bg-[color:var(--color-surface-2)]"
      aria-label={`Switch to ${theme() === 'paper' ? 'site (dark)' : 'paper (light)'} theme`}
    >
      <span aria-hidden="true">{theme() === 'paper' ? '◑' : '◐'}</span>
      <span>{theme() === 'paper' ? 'Paper' : 'Site'}</span>
    </button>
  );
}
