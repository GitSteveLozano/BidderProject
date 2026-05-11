import { createSignal, Show, For } from 'solid-js';

type LostBid = {
  id: string;
  client_name: string;
  service_line: string;
  estimated_value: number | null;
  outcome_competitor: string | null;
  outcome_winning_bid: number | null;
};

type PostmortemResult = {
  likely_reasons: string[];
  price_gap_analysis: {
    our_price: number;
    winning_price: number | null;
    delta_usd: number | null;
    delta_pct: number | null;
    interpretation: string;
  };
  exclusions_signal: string;
  capacity_factor: string;
  pattern_across_recent_losses: string;
  recommendations_for_next_bid: string[];
  confidence: 'low' | 'medium' | 'high';
};

export default function PostmortemRunner(props: { lostBids: LostBid[] }) {
  const [pickedId, setPickedId] = createSignal(props.lostBids[0]?.id ?? '');
  const [running, setRunning] = createSignal(false);
  const [result, setResult] = createSignal<PostmortemResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  function pickedBid() {
    return props.lostBids.find((b) => b.id === pickedId()) ?? null;
  }

  async function run() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const resp = await fetch('/api/bids/postmortem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bid_id: pickedId() }),
      });
      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}: ${await resp.text()}`);
      }
      setResult(await resp.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div class="grid lg:grid-cols-2 gap-8 mt-4">
      <section class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink-700">
            Pick a LOST bid
          </label>
          <select
            class="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
            value={pickedId()}
            onChange={(e) => setPickedId(e.currentTarget.value)}
          >
            <For each={props.lostBids}>
              {(b) => (
                <option value={b.id}>
                  {b.client_name} — {b.service_line} (${Number(b.estimated_value ?? 0).toLocaleString()}, lost to {b.outcome_competitor ?? '?'})
                </option>
              )}
            </For>
          </select>
        </div>

        <Show when={pickedBid()}>
          {(b) => (
            <div class="rounded-md border border-ink-200 bg-white p-4">
              <div class="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div class="text-xs text-ink-500">Our price</div>
                  <div class="font-mono">
                    ${Number(b().estimated_value ?? 0).toLocaleString()}
                  </div>
                </div>
                <Show when={b().outcome_winning_bid != null}>
                  <div>
                    <div class="text-xs text-ink-500">Winning price</div>
                    <div class="font-mono">
                      ${Number(b().outcome_winning_bid).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-ink-500">Gap</div>
                    <div class="font-mono">
                      {(() => {
                        const our = Number(b().estimated_value ?? 0);
                        const theirs = Number(b().outcome_winning_bid);
                        const pct = our ? ((our - theirs) / our) * 100 : 0;
                        return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
                      })()}
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </Show>

        <button
          onClick={run}
          disabled={running()}
          class="w-full rounded-md bg-accent-600 px-5 py-2.5 text-white font-medium hover:bg-accent-700 disabled:opacity-60"
        >
          {running() ? 'Analyzing…' : 'Run postmortem agent'}
        </button>
      </section>

      <section class="space-y-4">
        <Show when={error()}>
          <div class="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-800">
            <strong>Error:</strong> {error()}
          </div>
        </Show>

        <Show when={result()}>
          {(r) => (
            <>
              <div class="rounded-md border border-ink-200 bg-white p-4">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-semibold text-ink-900">
                    Likely reasons
                  </h3>
                  <span class={`text-xs px-2 py-0.5 rounded ${
                    r().confidence === 'high' ? 'bg-green-50 text-green-700' :
                    r().confidence === 'medium' ? 'bg-amber-50 text-amber-700' :
                    'bg-ink-100 text-ink-600'
                  }`}>
                    {r().confidence} confidence
                  </span>
                </div>
                <ul class="mt-2 text-sm space-y-1 text-ink-700">
                  <For each={r().likely_reasons}>
                    {(reason) => <li>· {reason}</li>}
                  </For>
                </ul>
              </div>

              <div class="rounded-md border border-ink-200 bg-white p-4">
                <h3 class="text-sm font-semibold text-ink-900">
                  Price gap interpretation
                </h3>
                <p class="mt-2 text-sm text-ink-700">
                  {r().price_gap_analysis.interpretation}
                </p>
              </div>

              <div class="rounded-md border border-ink-200 bg-white p-4">
                <h3 class="text-sm font-semibold text-ink-900">
                  Recommendations for next bid
                </h3>
                <ul class="mt-2 text-sm space-y-1 text-ink-700">
                  <For each={r().recommendations_for_next_bid}>
                    {(rec) => <li>· {rec}</li>}
                  </For>
                </ul>
              </div>

              <details class="rounded-md border border-ink-200 bg-white p-4">
                <summary class="cursor-pointer text-xs font-medium text-ink-500">
                  Other signals (exclusions, capacity, pattern)
                </summary>
                <div class="mt-2 space-y-2 text-sm text-ink-700">
                  <div>
                    <strong>Exclusions:</strong> {r().exclusions_signal}
                  </div>
                  <div>
                    <strong>Capacity:</strong> {r().capacity_factor}
                  </div>
                  <div>
                    <strong>Pattern:</strong> {r().pattern_across_recent_losses}
                  </div>
                </div>
              </details>
            </>
          )}
        </Show>
      </section>
    </div>
  );
}
