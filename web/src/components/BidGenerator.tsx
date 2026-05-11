import { createSignal, Show, For } from 'solid-js';

type Company = { id: string; name: string; segment: string };
type ServiceLine = { line_name: string; standard_exclusions: string[] };

type GenerateResponse = {
  bid_id: string;
  state: string;
  pricing: {
    target_price: number;
    range_low: number;
    range_high: number;
    labor: { total_hours: number; subtotal: number };
    materials: { subtotal: number };
    capacity_utilization_at_start: number;
    capacity_modifier: { action: string; rationale: string };
    narrative: string;
    citations: (string | null)[];
  };
  composition: {
    draft_markdown: string;
    exclusions_verified: boolean;
    exclusions_present: string[];
    exclusions_missing: string[];
    total_required: number;
  };
};

interface Props {
  companies: Company[];
  serviceLines: ServiceLine[];
}

export default function BidGenerator(props: Props) {
  const [companyId, setCompanyId] = createSignal(props.companies[0]?.id ?? '');
  const [serviceLine, setServiceLine] = createSignal(
    props.serviceLines[0]?.line_name ?? '',
  );
  const [clientName, setClientName] = createSignal(
    'Esprit Heights Phase 2 — McKenzie GC',
  );
  const [scopeSummary, setScopeSummary] = createSignal(
    'EIFS exterior package, ~3,200 sqft, ADEX system spec. Per drawings ' +
      'received from McKenzie GC. Multi-unit residential.',
  );
  const [laborHours, setLaborHours] = createSignal(312);
  const [helperHours, setHelperHours] = createSignal(80);
  const [materialQty, setMaterialQty] = createSignal(3200);
  const [submitting, setSubmitting] = createSignal(false);
  const [result, setResult] = createSignal<GenerateResponse | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [streamingText, setStreamingText] = createSignal('');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setError(null);
    setStreamingText('');
    try {
      const resp = await fetch('/api/bids/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId(),
          service_line: serviceLine(),
          client_name: clientName(),
          scope_summary: scopeSummary(),
          labor_plan: [
            { trade: 'eifs', hours: laborHours() },
            { trade: 'helper', hours: helperHours() },
          ],
          material_quantity: materialQty(),
          client_segment: 'repeat',
        }),
      });
      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}: ${await resp.text()}`);
      }
      // The Cloudflare Function streams a Server-Sent-Events response so
      // the bid renders progressively. Parse the SSE stream.
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Process complete SSE events (separated by \n\n)
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const block of events) {
          const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6));
          if (payload.type === 'token') {
            setStreamingText((s) => s + payload.text);
          } else if (payload.type === 'done') {
            setResult(payload.result);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="grid lg:grid-cols-2 gap-8">
      <form onSubmit={submit} class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink-700">Company</label>
          <select
            class="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
            value={companyId()}
            onChange={(e) => setCompanyId(e.currentTarget.value)}
          >
            <For each={props.companies}>
              {(c) => <option value={c.id}>{c.name} · {c.segment}</option>}
            </For>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-700">
            Service line
          </label>
          <select
            class="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
            value={serviceLine()}
            onChange={(e) => setServiceLine(e.currentTarget.value)}
          >
            <For each={props.serviceLines}>
              {(sl) => <option value={sl.line_name}>{sl.line_name}</option>}
            </For>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-700">
            Client name
          </label>
          <input
            type="text"
            class="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
            value={clientName()}
            onInput={(e) => setClientName(e.currentTarget.value)}
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-700">
            Scope summary
          </label>
          <textarea
            class="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
            rows={5}
            value={scopeSummary()}
            onInput={(e) => setScopeSummary(e.currentTarget.value)}
          />
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-medium text-ink-700">
              Primary trade hours
            </label>
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
              value={laborHours()}
              onInput={(e) => setLaborHours(parseInt(e.currentTarget.value || '0'))}
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-ink-700">
              Helper hours
            </label>
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
              value={helperHours()}
              onInput={(e) => setHelperHours(parseInt(e.currentTarget.value || '0'))}
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-ink-700">
              Material qty
            </label>
            <input
              type="number"
              class="mt-1 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm"
              value={materialQty()}
              onInput={(e) => setMaterialQty(parseInt(e.currentTarget.value || '0'))}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting()}
          class="w-full rounded-md bg-accent-600 px-5 py-2.5 text-white font-medium hover:bg-accent-700 disabled:opacity-60"
        >
          {submitting() ? 'Running 4 agents…' : 'Run all 4 generation agents'}
        </button>
      </form>

      <div class="space-y-4">
        <Show when={error()}>
          <div class="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-800">
            <strong>Error:</strong> {error()}
          </div>
        </Show>

        <Show when={streamingText() && !result()}>
          <div class="rounded-md border border-ink-200 bg-white p-4">
            <div class="text-xs font-medium text-ink-500 mb-2">
              Composition agent (streaming)
            </div>
            <pre class="whitespace-pre-wrap text-sm text-ink-900 font-sans">
              {streamingText()}
            </pre>
          </div>
        </Show>

        <Show when={result()}>
          {(r) => (
            <>
              <div class="rounded-md border border-ink-200 bg-white p-4">
                <div class="text-xs font-medium text-ink-500">Pricing</div>
                <div class="mt-2 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div class="font-mono">
                      ${r().pricing.target_price.toLocaleString()}
                    </div>
                    <div class="text-xs text-ink-500">target</div>
                  </div>
                  <div>
                    <div class="font-mono">
                      ${r().pricing.range_low.toLocaleString()}
                      –${r().pricing.range_high.toLocaleString()}
                    </div>
                    <div class="text-xs text-ink-500">range</div>
                  </div>
                  <div>
                    <div class="font-mono">
                      {Math.round(r().pricing.capacity_utilization_at_start * 100)}%
                    </div>
                    <div class="text-xs text-ink-500">
                      capacity → {r().pricing.capacity_modifier.action}
                    </div>
                  </div>
                </div>
                <p class="mt-3 text-sm text-ink-700">
                  {r().pricing.narrative}
                </p>
              </div>

              <div class="rounded-md border border-ink-200 bg-white p-4">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-medium text-ink-500">Exclusions</div>
                  <Show
                    when={r().composition.exclusions_verified}
                    fallback={
                      <span class="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                        ⚠ {r().composition.exclusions_missing.length} missing
                      </span>
                    }
                  >
                    <span class="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">
                      ✓ {r().composition.total_required} verified present
                    </span>
                  </Show>
                </div>
                <Show when={r().composition.exclusions_missing.length > 0}>
                  <ul class="mt-2 text-sm text-amber-800 space-y-1">
                    <For each={r().composition.exclusions_missing}>
                      {(e) => <li>· {e}</li>}
                    </For>
                  </ul>
                </Show>
              </div>

              <details class="rounded-md border border-ink-200 bg-white p-4">
                <summary class="cursor-pointer text-xs font-medium text-ink-500">
                  🔍 Numeric citation trail (every number traces to a tool call)
                </summary>
                <ul class="mt-2 text-xs text-ink-600 space-y-1">
                  <For each={r().pricing.citations}>
                    {(c) => <Show when={c}>{(cc) => <li>· {cc()}</li>}</Show>}
                  </For>
                </ul>
              </details>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
