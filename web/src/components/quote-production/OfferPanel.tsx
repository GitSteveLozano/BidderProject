/**
 * Offer recommendation panel — sits in the Pricing step's sidebar.
 *
 * Operator clicks "Ask Brief" and the panel POSTs /api/offer/recommend
 * with the current scope + line items. Backend produces a lookup spec,
 * executes deterministically, and returns recommended low/center/high
 * with rationale + citations. Operator can apply the center to the
 * quote-level margin slider with one click.
 *
 * The recommendation is advisory — the operator owns the final number.
 */
import { createSignal, Show, For } from 'solid-js';

interface OfferComputed {
  labor_total: number;
  material_total: number;
  overhead: number;
  margin_low_pct: number;
  margin_center_pct: number;
  margin_high_pct: number;
  capacity_narrative: string;
  win_rate_narrative: string;
}

interface OfferResponse {
  computed: OfferComputed;
  recommended_low: number;
  recommended_center: number;
  recommended_high: number;
  confidence: number;
  rationale_text: string;
  citations: Array<{ source: string; ref: string; contribution: string }>;
}

interface LineItemPreview {
  description: string;
  qty: number;
  unit: string;
}

interface Props {
  scopeSummary: () => string;
  lineItems: () => LineItemPreview[];
  currentBaseSubtotal: () => number;
  onApplyMargin: (centerPct: number) => void;
}

export default function OfferPanel(p: Props) {
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<OfferResponse | null>(null);
  const [showCitations, setShowCitations] = createSignal(false);

  const fetchRecommendation = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = p.lineItems().map((li) => ({
        description: li.description,
        qty: li.qty,
        unit: li.unit,
      }));
      if (items.length === 0) {
        setError('Add at least one line item first.');
        setLoading(false);
        return;
      }
      const r = await fetch('/api/offer/recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope_summary: p.scopeSummary() || items.map((i) => i.description).slice(0, 3).join(', '),
          line_items_preview: items,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `${r.status}`);
      }
      setResult((await r.json()) as OfferResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-surface)] p-5">
      <div class="flex items-baseline justify-between">
        <div class="text-eyebrow font-mono uppercase text-[color:var(--color-muted)]">
          Brief's read
        </div>
        <Show when={result()}>
          <span class="text-[10px] font-mono text-[color:var(--color-muted-2)]">
            confidence {Math.round((result()!.confidence ?? 0) * 100)}%
          </span>
        </Show>
      </div>

      <Show
        when={result()}
        fallback={
          <>
            <p class="mt-1.5 text-[12.5px] text-[color:var(--color-muted)] leading-relaxed">
              Ask Brief to recommend a price based on your past quotes, current capacity, and historical margins for this scope.
            </p>
            <button
              type="button"
              disabled={loading()}
              onClick={fetchRecommendation}
              class="mt-3 w-full font-mono text-[12px] uppercase tracking-wide border border-[color:var(--color-line)] hover:border-[color:var(--color-ink)] disabled:opacity-50 bg-white px-3 py-2 rounded-sm"
            >
              {loading() ? 'Asking…' : 'Ask Brief'}
            </button>
            <Show when={error()}>
              <p class="mt-2 text-[12px] text-[color:var(--color-danger,#a85432)]">{error()}</p>
            </Show>
          </>
        }
      >
        {(r) => (
          <>
            <div class="mt-3 grid grid-cols-3 gap-2 text-center">
              <div class="rounded-md bg-[color:var(--color-paper-2,#f6f4ef)] px-2 py-2">
                <div class="text-[10px] font-mono uppercase text-[color:var(--color-muted-2)]">Low</div>
                <div class="text-sm font-medium tabular-nums">${r().recommended_low.toLocaleString()}</div>
              </div>
              <div class="rounded-md bg-[color:var(--color-accent-tint,#fbe9d4)] px-2 py-2">
                <div class="text-[10px] font-mono uppercase text-[color:var(--color-muted-2)]">Center</div>
                <div class="text-sm font-medium tabular-nums">${r().recommended_center.toLocaleString()}</div>
              </div>
              <div class="rounded-md bg-[color:var(--color-paper-2,#f6f4ef)] px-2 py-2">
                <div class="text-[10px] font-mono uppercase text-[color:var(--color-muted-2)]">High</div>
                <div class="text-sm font-medium tabular-nums">${r().recommended_high.toLocaleString()}</div>
              </div>
            </div>

            <p class="mt-3 text-[12.5px] text-[color:var(--color-ink-2)] leading-relaxed">
              {r().rationale_text}
            </p>

            <div class="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => p.onApplyMargin(r().computed.margin_center_pct)}
                class="flex-1 font-mono text-[11px] uppercase tracking-wide border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] text-[color:var(--color-surface)] px-3 py-1.5 rounded-sm"
              >
                Apply {r().computed.margin_center_pct.toFixed(1)}% margin
              </button>
              <button
                type="button"
                onClick={() => setShowCitations((s) => !s)}
                class="font-mono text-[11px] uppercase tracking-wide border border-[color:var(--color-line)] bg-white px-3 py-1.5 rounded-sm"
              >
                {showCitations() ? 'Hide' : 'Cite'}
              </button>
            </div>

            <Show when={showCitations()}>
              <ul class="mt-3 space-y-1.5 text-[11.5px] font-mono">
                <For each={r().citations}>
                  {(c) => (
                    <li class="text-[color:var(--color-muted-2)]">
                      <span class="text-[color:var(--color-ink-2)]">{c.source}/{c.ref}</span> — {c.contribution}
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <button
              type="button"
              onClick={fetchRecommendation}
              disabled={loading()}
              class="mt-3 w-full font-mono text-[11px] uppercase text-[color:var(--color-muted-2)] hover:text-[color:var(--color-ink)] disabled:opacity-50"
            >
              {loading() ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        )}
      </Show>
    </div>
  );
}
