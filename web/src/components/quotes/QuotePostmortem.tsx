/**
 * <QuotePostmortem> — inline panel on /quotes/[id] when state=LOST.
 *
 * Click "Run postmortem" → POSTs /api/quote/postmortem → renders the
 * structured analysis (likely reasons, pinned price-gap math,
 * recommendations, pattern-across-recent-losses) using Brief tokens.
 */
import { createSignal, Show, For } from 'solid-js';
import Pill from '@/components/ui/Pill';
import Button from '@/components/ui/Button';

interface PostmortemResult {
  likely_reasons: string[];
  price_gap_analysis: {
    our_price: number;
    winning_price: number | null;
    delta_usd: number | null;
    delta_pct: number | null;
    interpretation: string;
  };
  scope_signal: string;
  relationship_factor: string;
  pattern_across_recent_losses: string;
  recommendations_for_next_bid: string[];
  confidence: 'low' | 'medium' | 'high';
}

interface Props {
  quote_id: string;
}

export default function QuotePostmortem(props: Props) {
  const [running, setRunning] = createSignal(false);
  const [result, setResult] = createSignal<PostmortemResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch('/api/quote/postmortem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quote_id: props.quote_id }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setResult(await resp.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const fmt = (n: number | null) =>
    n == null ? '—' : `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
      <div class="flex items-baseline gap-3 mb-3">
        <h3 class="font-serif text-base font-medium flex-1">Postmortem</h3>
        <Show when={result()}>
          <Pill
            tone={
              result()!.confidence === 'high'
                ? 'good'
                : result()!.confidence === 'medium'
                  ? 'info'
                  : 'neutral'
            }
            size="sm"
            dot={false}
          >
            {result()!.confidence} confidence
          </Pill>
        </Show>
      </div>

      <Show
        when={result()}
        fallback={
          <>
            <p class="text-sm font-serif italic text-[color:var(--color-muted)] leading-relaxed mb-4">
              Brief reads the quote, the competitor's bid, your shop's pricing
              defaults, and recent comparable losses — then writes a structured
              reasons-why and concrete moves for the next bid in this segment.
            </p>
            <div class="flex items-center justify-end">
              <Button variant="accent" disabled={running()} onClick={run}>
                {running() ? 'Analyzing…' : 'Run postmortem'}
              </Button>
            </div>
            <Show when={error()}>
              <div class="mt-3 rounded-lg bg-[color:var(--color-danger-tint)] px-3 py-2 text-sm text-[color:var(--color-danger)]">
                {error()}
              </div>
            </Show>
          </>
        }
      >
        {(r) => (
          <div class="space-y-4">
            {/* Price gap */}
            <div class="rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-line)] px-4 py-3">
              <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] mb-2">
                Price gap
              </div>
              <div class="grid grid-cols-3 gap-4 text-sm mb-2">
                <div>
                  <div class="text-xs text-[color:var(--color-muted)]">Ours</div>
                  <div class="font-mono tabular-nums mt-0.5">
                    {fmt(r().price_gap_analysis.our_price)}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-[color:var(--color-muted)]">Winning bid</div>
                  <div class="font-mono tabular-nums mt-0.5">
                    {fmt(r().price_gap_analysis.winning_price)}
                  </div>
                </div>
                <div>
                  <div class="text-xs text-[color:var(--color-muted)]">Delta</div>
                  <div
                    class={[
                      'font-mono tabular-nums mt-0.5',
                      r().price_gap_analysis.delta_pct == null
                        ? ''
                        : r().price_gap_analysis.delta_pct! > 0
                          ? 'text-[color:var(--color-danger)]'
                          : 'text-[color:var(--color-good)]',
                    ].join(' ')}
                  >
                    <Show when={r().price_gap_analysis.delta_pct != null} fallback="—">
                      {r().price_gap_analysis.delta_pct! >= 0 ? '+' : '−'}
                      {Math.abs(r().price_gap_analysis.delta_pct!).toFixed(1)}%
                    </Show>
                  </div>
                </div>
              </div>
              <p class="text-[13px] font-serif italic text-[color:var(--color-ink-2)] leading-relaxed border-t border-[color:var(--color-line)] pt-2">
                {r().price_gap_analysis.interpretation}
              </p>
            </div>

            {/* Likely reasons */}
            <Section title="Likely reasons">
              <ul class="space-y-1.5 text-sm leading-relaxed">
                <For each={r().likely_reasons}>
                  {(reason) => (
                    <li class="flex items-start gap-2">
                      <span class="mt-2 w-1 h-1 rounded-full bg-[color:var(--color-accent)] shrink-0" aria-hidden="true" />
                      <span class="flex-1">{reason}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Section>

            {/* Recommendations */}
            <Section title="For the next bid in this segment">
              <ul class="space-y-1.5 text-sm leading-relaxed">
                <For each={r().recommendations_for_next_bid}>
                  {(rec) => (
                    <li class="flex items-start gap-2">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-[color:var(--color-accent)] mt-1 shrink-0" aria-hidden="true">
                        <path d="M2.5 6.5l2.5 2.5 5-5.5" />
                      </svg>
                      <span class="flex-1">{rec}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Section>

            {/* Other signals */}
            <details class="rounded-lg bg-[color:var(--color-surface-2)] border border-[color:var(--color-line)] px-4 py-3">
              <summary class="cursor-pointer text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
                Other signals
              </summary>
              <dl class="mt-3 space-y-2 text-[13px] leading-relaxed">
                <div>
                  <dt class="text-xs text-[color:var(--color-muted)]">Scope</dt>
                  <dd class="mt-0.5">{r().scope_signal}</dd>
                </div>
                <div>
                  <dt class="text-xs text-[color:var(--color-muted)]">Relationship</dt>
                  <dd class="mt-0.5">{r().relationship_factor}</dd>
                </div>
                <div>
                  <dt class="text-xs text-[color:var(--color-muted)]">Pattern across recent losses</dt>
                  <dd class="mt-0.5">{r().pattern_across_recent_losses}</dd>
                </div>
              </dl>
            </details>

            <div class="flex justify-end">
              <button
                type="button"
                onClick={run}
                disabled={running()}
                class="text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] underline"
              >
                {running() ? 'Re-running…' : 'Run again'}
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

function Section(p: { title: string; children: any }) {
  return (
    <div>
      <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)] mb-2">
        {p.title}
      </div>
      {p.children}
    </div>
  );
}
