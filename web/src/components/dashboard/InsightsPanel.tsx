/**
 * Insights panel — the only operator-facing surface for the
 * Intelligence agent. Lives at the top of /dashboard. Shows up to
 * three active findings; operator can dismiss with one click.
 *
 * Findings are generated server-side by:
 *   - the Intelligence pass after every mark-won/mark-lost
 *   - the nightly cron sweep
 * The operator never asks for them — they appear when there's
 * signal, fade when dismissed or when they expire.
 */
import { createSignal, For, Show } from 'solid-js';

interface Finding {
  id: string;
  finding_type: 'capacity_pricing' | 'winrate_by_size' | 'margin_trend' | 'exclusions_drift';
  headline: string;
  body: string;
  sample_size: number;
  projected_impact_usd: number | null;
  generated_at: string;
}

interface Props {
  initialFindings: Finding[];
}

const TYPE_LABEL: Record<Finding['finding_type'], string> = {
  capacity_pricing: 'Capacity',
  winrate_by_size: 'Win rate',
  margin_trend: 'Margin',
  exclusions_drift: 'Exclusions',
};

export default function InsightsPanel(props: Props) {
  const [findings, setFindings] = createSignal<Finding[]>(props.initialFindings);

  const dismiss = async (id: string) => {
    setFindings(findings().filter((f) => f.id !== id));
    try {
      await fetch('/api/intelligence/findings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action: 'dismiss' }),
        credentials: 'same-origin',
      });
    } catch {
      // Best-effort; if it fails, the next page load will re-fetch.
    }
  };

  return (
    <Show when={findings().length > 0}>
      <section class="mb-8 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
        <div class="flex items-baseline justify-between mb-3">
          <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted-2)]">
            Brief noticed
          </div>
          <span class="text-[11px] font-mono text-[color:var(--color-muted-2)]">
            {findings().length} active
          </span>
        </div>
        <ul class="space-y-3">
          <For each={findings().slice(0, 3)}>
            {(f) => (
              <li class="flex items-start gap-3 border-t border-[color:var(--color-line)] pt-3 first:border-t-0 first:pt-0">
                <span class="mt-1 text-[10px] font-mono uppercase tracking-wide text-[color:var(--color-accent)] bg-[color:var(--color-accent-tint,#fbe9d4)] px-1.5 py-0.5 rounded-sm shrink-0">
                  {TYPE_LABEL[f.finding_type]}
                </span>
                <div class="flex-1 min-w-0">
                  <h4 class="font-medium text-[14px] leading-snug">{f.headline}</h4>
                  <p class="mt-1 text-[13px] text-[color:var(--color-ink-2)] leading-relaxed">{f.body}</p>
                  <div class="mt-1.5 text-[11px] font-mono text-[color:var(--color-muted-2)]">
                    n={f.sample_size}
                    {f.projected_impact_usd != null &&
                      ` · projected impact $${f.projected_impact_usd.toLocaleString()}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(f.id)}
                  aria-label="Dismiss finding"
                  class="text-[11px] font-mono uppercase text-[color:var(--color-muted-2)] hover:text-[color:var(--color-ink)] shrink-0"
                >
                  Dismiss
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
